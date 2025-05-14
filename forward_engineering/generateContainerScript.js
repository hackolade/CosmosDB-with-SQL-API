const _ = require('lodash');
const { getIndexPolicyScript } = require('./helpers/getIndexPolicyScript');
const { getPartitionKey } = require('./helpers/getPartitionKey');
const { buildAzureCLIScript } = require('./helpers/azureCLIScriptHelpers/buildAzureCLIScript');
const { getUniqueKeyPolicyScript } = require('./helpers/getUniqueKeyPolicyScript');
const { updateSample } = require('./helpers/updateSample');
const { addItems } = require('./helpers/addItems');

const generateContainerScript = (data, logger, callback, app) => {
	try {
		const insertSamplesOption =
			_.get(data, 'options.additionalOptions', []).find(option => option.id === 'INCLUDE_SAMPLES') || {};
		const withSamples = data.options.origin !== 'ui';
		const samples = data.entities.map(entityId =>
			updateSample(
				JSON.parse(data.jsonData[entityId]),
				data.containerData[0],
				(data.entityData[entityId] || [])[0] || {},
			),
		);
		if (data.options?.targetScriptOptions?.keyword === 'containerSettingsJson') {
			const uniqueKeys = _.get(data.containerData, '[0].uniqueKey', []);
			const scriptData = {
				partitionKey: getPartitionKey(data.containerData),
				...(uniqueKeys.length && getUniqueKeyPolicyScript(uniqueKeys)),
				indexingPolicy: getIndexPolicyScript(data.containerData),
				...(withSamples && { sample: samples }),
				...addItems(data.containerData),
			};
			const script = JSON.stringify(scriptData, null, 2);
			if (withSamples || !insertSamplesOption.value) {
				return callback(null, script);
			}

			return callback(null, [
				{ title: 'CosmosDB script', script },
				{ title: 'Sample data', script: JSON.stringify(samples, null, 2) },
			]);
		}

		const script = buildAzureCLIScript({
			...data,
		});

		if (withSamples || !insertSamplesOption.value) {
			return callback(null, script);
		}

		return callback(null, [
			{ title: 'Azure CLI script', script },
			{ title: 'Sample data', script: JSON.stringify(samples, null, 2) },
		]);
	} catch (e) {
		const error = { message: e.message, stack: e.stack };
		logger.log('error', error, 'CosmosDB w\\ SQL API forward engineering error');
		callback(error);
	}
};

module.exports = {
	generateContainerScript,
};
