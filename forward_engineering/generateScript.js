const _ = require('lodash');
const { getIndexPolicyScript } = require('./helpers/getIndexPolicyScript');
const { getPartitionKey } = require('./helpers/getPartitionKey');
const { addItems } = require('./helpers/addItems');
const { getUniqueKeyPolicyScript } = require('./helpers/getUniqueKeyPolicyScript');
const { updateSample } = require('./helpers/updateSample');

const generateScript = (data, logger, callback, app) => {
	try {
		const uniqueKeys = _.get(data.containerData, '[0].uniqueKey', []);

		const script = {
			partitionKey: getPartitionKey(data.containerData),
			indexingPolicy: getIndexPolicyScript(data.containerData),
			...(uniqueKeys.length && getUniqueKeyPolicyScript(uniqueKeys)),
			sample: updateSample(JSON.parse(data.jsonData), data.containerData[0], data.entityData[0]),
			...addItems(data.containerData),
		};
		return callback(null, JSON.stringify(script, null, 2));
	} catch (e) {
		const error = { message: e.message, stack: e.stack };
		logger.log('error', error, 'CosmosDB w\\ SQL API forward engineering error');
		callback(error);
	}
};

module.exports = {
	generateScript,
};
