const reApi = require('../../reverse_engineering/api');
const setUpDocumentClient = require('../../reverse_engineering/helpers/setUpDocumentClient');

const createOrUpdate = async (sample, container) => {
	try {
		await container.items.create(sample);
	} catch (error) {
		if (error.code !== 409) {
			throw error;
		}

		await container.items.upsert(sample);
	}
};

const addDataType = (indexes) => {
	return indexes.map(index => {
		if (!Array.isArray(index.indexes)) {
			return index;
		}

		return {
			...index,
			indexes: index.indexes.map(item => ({
				...item,
				dataType: item.dataType || 'String',
			})),
		};
	});
};

const updateIndexingPolicy = (indexes) => {
	const result = {...indexes};
	
	if (Array.isArray(result.includedPaths)) {
		result.includedPaths = addDataType(result.includedPaths);
	}

	if (Array.isArray(result.excludedPaths)) {
		result.excludedPaths = addDataType(result.excludedPaths);
	}

	return result;
};

module.exports = {
	testConnection: reApi.testConnection,
	async applyToInstance(connectionInfo, logger, callback, app) {
		try {
			const _ = app.require('lodash');
			logger.progress = logger.progress || (() => {});
			logger.clear();
			logger.log('info', connectionInfo, 'Apply to instance connection settings', connectionInfo.hiddenKeys);
			const client = setUpDocumentClient(connectionInfo);
			const script = JSON.parse(connectionInfo.script);
			const databaseId = _.get(connectionInfo, 'containerData[0].dbId');
			const containerId = _.get(connectionInfo, 'containerData[0].name');

			if (!databaseId) {
				return callback({
					message: 'Database ID is required. Please, set it on container level.',
				});
			}

			const progress = createLogger(logger, databaseId, containerId);
			
			progress('Create database if not exists...');

			const { database } = await client.databases.createIfNotExists({ id: databaseId });
			
			progress('Create container  if not exists ...');

			const { container, resource: containerDef } = await database.containers.createIfNotExists({ id: containerId });

			progress('Add sample documents ...');

			if (Array.isArray(script.sample)) {
				await script.sample.reduce(async (next, sample) => {
					await next;
					return createOrUpdate(sample, container);  
				}, Promise.resolve());
			} else {
				await createOrUpdate(script.sample, container);  
			}

			progress('Update indexing policy ...');

			await container.replace({
				id: containerId,
				partitionKey: containerDef.partitionKey,
				indexingPolicy: updateIndexingPolicy(script.indexingPolicy),
			});

			progress('Applying to instance finished');

			callback(null);
		} catch (error) {
			callback({
				message: error.message,
				stack: error.stack,
			});
		}
	}
};

const createLogger = (logger, containerName, entityName) => (message) => {
	logger.progress({ message, containerName, entityName });
	logger.log('info', { message }, 'Applying to instance');
};

