const add = (key, value) => obj => {
	if (
		value === undefined
		||
		value === ''
		||
		(Array.isArray(value) && value.length === 0)
	) {
		return obj;
	}
	
	return {
		...obj,
		[key]: value
	};
};

const getPath = (paths = []) => {
	const pathItem = (paths[0] || {});

	if (Array.isArray(pathItem.path) && pathItem.path.length !== 0) {
		return ['', ...pathItem.name.split('.').slice(1), ''].join('/') + (pathItem.type || '');
	}

	return pathItem.name + (pathItem.type || '');
};

const getIndex = (_) => (item) => {
	const precision = Number(item.indexPrecision);
	return _.flow(
		add('kind', item.kind),
		add('dataType', item.dataType),
		add('precision', isNaN(precision) ? undefined : Number(precision)),
	)({});
};

const getIncludedPath = (_) => (includedPaths = []) => {
	return includedPaths.map(item => {
		return _.flow(
			add('path', getPath(item.indexIncludedPath)),
			add('indexes', (item.inclIndexes || []).map(getIndex(_))),
		)({});
	});
};

const getExcludedPath = (_) => (excludedPaths = []) => {
	return excludedPaths.map(item => {
		return _.flow(
			add('path', getPath(item.indexExcludedPath)),
			add('indexes', (item.exclIndexes || []).map(getIndex(_))),
		)({});
	});
};

const getCompositeIndexes = (_) => (compositeIndexes = []) => {
	return compositeIndexes.map(item => {
		return _.flow(
			add('path', getPath(item.compositeFieldPath)),
			add('order', item.compositeFieldOrder || 'ascending'),
		)({});
	});
};

const getSpatialIndexes = (_) => (spatialIndexes = []) => {
	return spatialIndexes.map(item => {
		return _.flow(
			add('path', getPath(item.indexIncludedPath)),
			add('dataTypes', (item.dataTypes || []).map(dataType => dataType.spatialType).filter(Boolean)),
		)({});
	});
};

const getIndexPolicyScript = (_) => (containerData) => {
	const indexTab = containerData[1] || {};

	const indexScript = _.flow(
		add('automatic', indexTab.automatic === 'true'),
		add('indexingMode', indexTab.indexingMode),
		add('includedPaths', getIncludedPath(_)(indexTab.includedPaths)),
		add('excludedPaths', getExcludedPath(_)(indexTab.excludedPaths)),
		add('spatialIndexes', getSpatialIndexes(_)(indexTab.spatialIndexes)),
		add('compositeIndexes', getCompositeIndexes(_)(indexTab.compositeIndexes)),
	)({});
	
	return indexScript;
};

module.exports = getIndexPolicyScript;
