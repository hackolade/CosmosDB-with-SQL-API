const getUniqueKeys = uniqueKeys => {
	if (!uniqueKeys) {
		return [];
	}

	return uniqueKeys
		.filter(
			uniqueKey =>
				uniqueKey.attributePath && Array.isArray(uniqueKey.attributePath) && uniqueKey.attributePath.length,
		)
		.map(uniqueKey => {
			return {
				paths: uniqueKey.attributePath
					.map(path => '/' + path.name.split('.').slice(1).join('/'))
					.filter(Boolean),
			};
		})
		.filter(path => path.paths.length);
};

const getUniqueKeyPolicyScript = uniqueKeys => {
	return { uniqueKeyPolicy: { uniqueKeys: getUniqueKeys(uniqueKeys) } };
};

module.exports = { getUniqueKeyPolicyScript };
