const add = (key, value) => obj => {
	if (value === undefined || value === '' || (Array.isArray(value) && value.length === 0)) {
		return obj;
	}

	return {
		...obj,
		[key]: value,
	};
};

const escapeName = name => {
	if (/^[0-9]/.test(name)) {
		return `"${name}"`;
	} else if (/^[a-z0-9_]*$/i.test(name)) {
		return name;
	} else {
		return `"${name}"`;
	}
};

const prepareName = name => {
	const isArrayIndex = /^\[\d*\]$/.test(name);

	if (isArrayIndex) {
		return '[]';
	}

	return escapeName(name);
};

const getPath = (paths = []) => {
	const pathItem = paths[0];

	if (!pathItem) {
		return '';
	}

	if (Array.isArray(pathItem.path) && pathItem.path.length !== 0) {
		const name = pathItem.name.split('/');
		return ['', ...name.slice(1, -1).map(prepareName), ''].join('/') + name[name.length - 1];
	}

	const items = pathItem.name.split('/');
	return items
		.slice(0, -1)
		.map(name => {
			if (/^"/.test(name) && /"$/.test(name)) {
				return name;
			}

			return escapeName(name);
		})
		.concat(items[items.length - 1])
		.join('/');
};

const filterDeactivated = items => {
	return (items || []).filter(item => {
		return item.isActivated !== false;
	});
};

const getIndex = _ => item => {
	const precision = Number(item.indexPrecision);
	return _.flow(
		add('kind', item.kind),
		add('dataType', item.dataType),
		add('precision', isNaN(precision) ? undefined : Number(precision)),
	)({});
};

const getIncludedPath =
	_ =>
	(includedPaths = []) => {
		return filterDeactivated(includedPaths)
			.map(item => {
				return _.flow(add('path', getPath(item.indexIncludedPath)))({});
			})
			.filter(item => !_.isEmpty(item));
	};

const getExcludedPath =
	_ =>
	(excludedPaths = []) => {
		return filterDeactivated(excludedPaths)
			.map(item => {
				return _.flow(add('path', getPath(item.indexExcludedPath)))({});
			})
			.filter(item => !_.isEmpty(item));
	};

const getCompositeIndexes =
	_ =>
	(compositeIndexes = []) => {
		return filterDeactivated(compositeIndexes)
			.map(item => {
				if (!Array.isArray(item.compositeFieldPath)) {
					return;
				}

				return _.uniqWith(
					item.compositeFieldPath.map(item => {
						const path = item.name.split('/');

						return {
							path: ['', ...path.slice(1).map(prepareName)].join('/'),
							order: item.type || 'ascending',
						};
					}),
					(a, b) => a.path === b.path,
				).filter(item => !_.isEmpty(item));
			})
			.filter(item => !_.isEmpty(item));
	};

const getSpatialIndexes =
	_ =>
	(spatialIndexes = []) => {
		return filterDeactivated(spatialIndexes)
			.map(item => {
				return _.flow(
					add('path', getPath(item.indexIncludedPath)),
					add('types', (item.dataTypes || []).map(dataType => dataType.spatialType).filter(Boolean)),
				)({});
			})
			.filter(item => !_.isEmpty(item) && item.path);
	};

const getIndexPolicyScript = _ => containerData => {
	const indexTab = containerData[1] || {};

	const indexScript = _.flow(
		add('automatic', indexTab.indexingAutomatic === 'true'),
		add('indexingMode', indexTab.indexingMode),
		add('includedPaths', getIncludedPath(_)(indexTab.includedPaths)),
		add('excludedPaths', getExcludedPath(_)(indexTab.excludedPaths)),
		add('spatialIndexes', getSpatialIndexes(_)(indexTab.spatialIndexes)),
		add('compositeIndexes', getCompositeIndexes(_)(indexTab.compositeIndexes)),
	)({});

	return indexScript;
};

module.exports = getIndexPolicyScript;
