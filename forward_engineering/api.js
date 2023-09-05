const applyToInstanceHelper = require('./applyToInstance');
const getIndexPolicyScript = require('./helpers/getIndexPolicyScript');
const { PARTITION_KEY_DEFINITION_VERSION, PARTITION_KEY_KIND } = require('../shared/constants');

module.exports = {
	generateContainerScript(data, logger, callback, app) {
		try {
			const _ = app.require('lodash');
			const insertSamplesOption = _.get(data, 'options.additionalOptions', []).find(option => option.id === 'INCLUDE_SAMPLES') || {};
			const withSamples = data.options.origin !== 'ui';
			const samples = data.entities.map(entityId => updateSample(
				JSON.parse(data.jsonData[entityId]),
				data.containerData[0],
				(data.entityData[entityId] || [])[0] || {},
			));
			const scriptData = {
				partitionKey: getPartitionKey(_)(data.containerData),
				indexingPolicy: getIndexPolicyScript(_)(data.containerData),
				...(withSamples && { sample: samples }),
				...addItems(_)(data.containerData),
			};
			const script = JSON.stringify(scriptData, null, 2);
			if (withSamples || !insertSamplesOption.value) {
				return callback(null, script);
			}

			return callback(null, [
				{ title: 'CosmosDB script', script },
				{
					title: 'Sample data',
					script: JSON.stringify(samples, null, 2),
				},
			]);
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
				partitionKey: getPartitionKey(_)(data.containerData),
				indexingPolicy: getIndexPolicyScript(_)(data.containerData),
				sample: updateSample(
					JSON.parse(data.jsonData),
					data.containerData[0],
					data.entityData[0],
				),
				...addItems(_)(data.containerData),
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
	const docType = containerData?.docTypeName;

	if (!docType) {
		return sample;
	}

	return {
		...sample,
		[docType]: entityData.code || entityData.collectionName,
	};
};

const getPartitionKey = (_) => (containerData) => {
	const fixNamePath = (key) => (key?.name || '').trim().replace(/\/$/, '');
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

const add = (key, items, mapper) => (script) => {
	if (!items.length) {
		return script;
	}

	return {
		...script,
		[key]: mapper(items),
	};
};

const addItems = (_) => (containerData) => {
	return _.flow(
		add('Stored Procedures', _.get(containerData, '[2].storedProcs', []), mapStoredProcs),
		add('User Defined Functions', _.get(containerData, '[4].udfs', []), mapUDFs),
		add('Triggers', _.get(containerData, '[3].triggers', []), mapTriggers),
	)();
};

const mapUDFs = (udfs) => {
	return udfs.map(udf => {
		return {
			id: udf.udfID,
			body: udf.udfFunction,
		};
	});
};

const mapTriggers = (triggers) => {
	return triggers.map(trigger => {
		return {
			id: trigger.triggerID,
			body: trigger.triggerFunction,
			triggerOperation: trigger.triggerOperation,
			triggerType: trigger.prePostTrigger === 'Pre-Trigger' ? 'Pre' : 'Post'
		};
	});
};

const mapStoredProcs = (storedProcs) => {
	return storedProcs.map(proc => {
		return {
			id: proc.storedProcID,
			body: proc.storedProcFunction,
		};
	});
};
