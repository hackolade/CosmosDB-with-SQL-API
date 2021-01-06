const applyToInstanceHelper = require('./applyToInstance');
const getIndexPolicyScript = require('./helpers/getIndexPolicyScript');

module.exports = {
	generateContainerScript(data, logger, callback, app) {
		try {
			const _ = app.require('lodash');
			const script = {
				indexingPolicy: getIndexPolicyScript(_)(data.containerData),
				sample: data.entities.map(entityId => updateSample(
					JSON.parse(data.jsonData[entityId]),
					data.containerData[0],
					(data.entityData[entityId] || [])[0] || {},
				)),
			};
			return callback(null, JSON.stringify(script, null, 2));
		} catch (e) {
			const error = { message: e.message, stack: e.stack };
			logger.log('error', error, 'CosmosDB w\\ SQL API forward engineering error');
			callback(error);
		}
	},
	generateScript(data, logger, callback, app) {
		try {
			const _ = app.require('lodash');
			const script = {
				indexingPolicy: getIndexPolicyScript(_)(data.containerData),
				sample: updateSample(
					JSON.parse(data.jsonData),
					data.containerData[0],
					data.entityData[0],
				),
			};
			return callback(null, JSON.stringify(script, null, 2));
		} catch (e) {
			const error = { message: e.message, stack: e.stack };
			logger.log('error', error, 'CosmosDB w\\ SQL API forward engineering error');
			callback(error);
		}
	},
	applyToInstance: applyToInstanceHelper.applyToInstance,

	testConnection: applyToInstanceHelper.testConnection,
};

const updateSample = (sample, containerData, entityData) => {
	const docType = containerData.docTypeName;

	if (!docType) {
		return sample;
	}

	return {
		...sample,
		[docType]: entityData.code || entityData.collectionName,
	};
};
