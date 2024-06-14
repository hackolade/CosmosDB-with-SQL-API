const reApi = require('../../reverse_engineering/api');
const executeWithTimeout = require('../../reverse_engineering/helpers/executeWithTimeout');
const { TTL_ON, TTL_ON_DEFAULT } = require('../../shared/constants');
const applyToInstanceHelper = require('./applyToInstanceHelper');

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

const addDataType = indexes => {
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

const addSpatialTypes = spatialIndex => {
	if (Array.isArray(spatialIndex.types) && spatialIndex.types.length) {
		return spatialIndex;
	}

	return {
		...spatialIndex,
		types: ['Point', 'LineString', 'Polygon', 'MultiPolygon'],
	};
};

const updateIndexingPolicy = indexes => {
	const result = { ...indexes };

	if (Array.isArray(result.includedPaths)) {
		result.includedPaths = addDataType(result.includedPaths);
	}

	if (Array.isArray(result.excludedPaths)) {
		result.excludedPaths = addDataType(result.excludedPaths);
	}

	if (Array.isArray(result.spatialIndexes)) {
		result.spatialIndexes = result.spatialIndexes.map(addSpatialTypes);
	}

	return result;
};

module.exports = {
	testConnection: reApi.testConnection,
	async applyToInstance(connectionInfo, logger, callback, app) {
		const _ = app.require('lodash');
		try {
			const helper = applyToInstanceHelper(_);
			logger.progress = logger.progress || (() => {});
			logger.clear();
			logger.log('info', connectionInfo, 'Apply to instance connection settings', connectionInfo.hiddenKeys);
			const client = helper.setUpDocumentClient(connectionInfo);
			const script = parseScript(connectionInfo.script);
			const containerData = _.get(connectionInfo, 'containerData[0]');
			const databaseId = _.get(containerData, 'dbId');
			const containerId = _.get(containerData, 'name');

			if (!databaseId) {
				return callback({
					message: 'Database ID is required. Please, set it on container level.',
				});
			}

			const progress = createLogger(logger, databaseId, containerId);

			progress('Create database if not exists...');

			const { database } = await executeWithTimeout(() => client.databases.createIfNotExists({ id: databaseId }));

			progress('Create container  if not exists ...');

			const shouldIncludeTtl = [TTL_ON, TTL_ON_DEFAULT].includes(containerData.TTL);
			const { container, resource: containerDef } = await database.containers.createIfNotExists({
				id: containerId,
				partitionKey: script.partitionKey,
				...(shouldIncludeTtl && { defaultTtl: helper.getTTL(containerData) }),
				...(script.uniqueKeyPolicy && { uniqueKeyPolicy: script.uniqueKeyPolicy }),
				...helper.getContainerThroughputProps(containerData),
			});

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
				...containerDef,
				indexingPolicy: updateIndexingPolicy(script.indexingPolicy),
			});

			const storedProcs = _.get(script, 'Stored Procedures', []);
			if (storedProcs.length) {
				progress('Upload stored procs ...');
				await helper.createStoredProcs(storedProcs, container);
			}

			const udfs = _.get(script, 'User Defined Functions', []);
			if (udfs.length) {
				progress('Upload user defined functions ...');
				await helper.createUDFs(udfs, container);
			}

			const triggers = _.get(script, 'Triggers', []);
			if (triggers.length) {
				progress('Upload triggers ...');
				await helper.createTriggers(triggers, container);
			}

			progress('Applying to instance finished');

			callback(null);
		} catch (error) {
			error.message = _.get(error, 'response.data.error.message', error.message || error.name);
			logger.log('error', error);
			callback({
				message: error.message,
				stack: error.stack,
			});
		}
	},
};

const createLogger = (logger, containerName, entityName) => message => {
	logger.progress({ message, containerName, entityName });
	logger.log('info', { message }, 'Applying to instance');
};

const parseScript = script => {
	try {
		return JSON.parse(script);
	} catch (err) {
		const [main, sample] = script.split(/\n}\n\[/m);
		const mainScript = JSON.parse(main + '}');
		const sampleScript = JSON.parse('[' + sample);

		return {
			...mainScript,
			sample: sampleScript,
		};
	}
};
