const { PARTITION_KEY_DEFINITION_VERSION, PARTITION_KEY_KIND } = require('../../shared/constants');

const getPartitionKey = _ => containerData => {
	const fixNamePath = key => (key?.name || '').trim().replace(/\/$/, '');
	const partitionKeys = _.get(containerData, '[0].partitionKey', []);
	const isHierarchical = _.get(containerData, '[0].hierarchicalPartitionKey', false);

	if (!isHierarchical) {
		return fixNamePath(partitionKeys[0]);
	}

	return {
		paths: partitionKeys.map(fixNamePath),
		version: PARTITION_KEY_DEFINITION_VERSION.v2,
		kind: PARTITION_KEY_KIND.MultiHash,
	};
};

module.exports = getPartitionKey;
