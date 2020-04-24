'use strict';

const { CosmosClient } = require('@azure/cosmos');
const _ = require('lodash');
const axios = require('axios');
const qs = require('qs');
let client;

module.exports = {
	connect: function(connectionInfo, logger, cb) {
		cb()
	},

	disconnect: function(connectionInfo, logger, cb) {
		cb()
	},

	testConnection: async function(connectionInfo, logger, cb) {
		logger.clear();
		client = setUpDocumentClient(connectionInfo);
		try {
			await getDatabasesData();
			return cb();
		} catch(err) {
			return cb(mapError(err));
		}
	},

	getDatabases: async function(connectionInfo, logger, cb) {
		client = setUpDocumentClient(connectionInfo);
		logger.clear();
		logger.log('info', connectionInfo, 'Reverse-Engineering connection settings', connectionInfo.hiddenKeys);

		try {
			const dbsData = await getDatabasesData();
			const dbs = dbsData.map(item => item.id);
			logger.log('info', dbs, 'All databases list', connectionInfo.hiddenKeys);
			return cb(null, dbs);
		} catch(err) {
			logger.log('error', err);
			return cb(mapError(err));
		}
	},

	getDocumentKinds: async function(connectionInfo, logger, cb) {
		client = setUpDocumentClient(connectionInfo);
		logger.log('info', connectionInfo, 'Reverse-Engineering connection settings', connectionInfo.hiddenKeys);
		
		try {
			const collections = await listCollections(connectionInfo.database);
			logger.log('collections list', collections, 'Mapped collection list');
			const documentKindsPromise = collections.map(async collectionData => {
				const containerInstance = client.database(connectionInfo.database).container(collectionData.id);

				const documentsAmount = await getDocumentsAmount(containerInstance);
				const size = getSampleDocSize(documentsAmount, connectionInfo.recordSamplingSettings) || 1000;
				logger.log('info', { collectionItem: collectionData }, 'Getting documents for current collectionItem', connectionInfo.hiddenKeys);

				const documents = await getDocuments(containerInstance, size);
				const filteredDocuments = filterDocuments(documents);

				const inferSchema = generateCustomInferSchema(filteredDocuments, { sampleSize: 20 });
				const documentsPackage = getDocumentKindDataFromInfer({ bucketName: collectionData.id,
					inference: inferSchema, isCustomInfer: true, excludeDocKind: connectionInfo.excludeDocKind }, 90);

				return documentsPackage;
			});
			const documentKinds = await Promise.all(documentKindsPromise);
			cb(null, documentKinds);
		} catch(err) {
			console.log(err);
			logger.log('error', err);
			return cb(mapError(err));
		}
	},

	getDbCollectionsNames: async function(connectionInfo, logger, cb) {
		try {
			client = setUpDocumentClient(connectionInfo);
			logger.log('info', connectionInfo, 'Reverse-Engineering connection settings', connectionInfo.hiddenKeys);
			
			logger.log('info', { Database: connectionInfo.database }, 'Getting collections list for current database', connectionInfo.hiddenKeys);
			const collections = await listCollections(connectionInfo.database);
			
			logger.log('info', { CollectionList: collections }, 'Collection list for current database', connectionInfo.hiddenKeys);
			const collectionNames = collections.map(item => item.id);
			
			const items = await handleBucket(connectionInfo, collectionNames);
			cb(null, items)
		} catch(err) {
			console.log(err);
			logger.log('error', err);
			return cb(mapError(err));
		}
	},

	getDbCollectionsData: async function(data, logger, cb) {
		try {
			logger.progress = logger.progress || (() => {});
			client = setUpDocumentClient(data);
			logger.log('info', data, 'Reverse-Engineering connection settings', data.hiddenKeys);

			const { recordSamplingSettings, fieldInference } = data;
			logger.log(
				'info',
				getSamplingInfo(recordSamplingSettings, fieldInference),
				'Reverse-Engineering sampling params',
				data.hiddenKeys
			);

			const bucketList = data.collectionData.dataBaseNames;
			logger.log('info', { CollectionList: bucketList }, 'Selected collection list', data.hiddenKeys);

			const { resource: accountInfo } = await client.getDatabaseAccount();
			const additionalAccountInfo = await getAdditionalAccountInfo(data, logger);
			const modelInfo = Object.assign({
				accountID: data.accountKey,
				defaultConsistency: accountInfo.consistencyPolicy,
				preferredLocation: accountInfo.writableLocations[0] ? accountInfo.writableLocations[0].name : '',
				tenant: data.tenantId,
				resGrp: data.resourceGroupName,
				subscription: data.subscriptionId
			}, additionalAccountInfo);

			logger.log('info', modelInfo, 'Model info', data.hiddenKeys);
			const dbCollectionsPromise = bucketList.map(async bucketName => {
				const containerInstance = client.database(data.database).container(bucketName);
				const storedProcs = await getStoredProcedures(containerInstance);
				const triggers = await getTriggers(containerInstance);
				const udfs = await getUdfs(containerInstance);
				const collection = await getCollectionById(containerInstance);
				const offerInfo = await getOfferType(collection);
				const { autopilot, throughput } = getOfferProps(offerInfo);
				const bucketInfo = {
					dbId: data.database,
					throughput,
					autopilot,
					partitionKey: getPartitionKey(collection),
					uniqueKey: getUniqueKeys(collection),
					storedProcs,
					triggers,
					udfs,
					TTL: getTTL(collection.defaultTtl),
					TTLseconds: collection.defaultTtl
				};
				const indexes = getIndexes(collection.indexingPolicy);

				const documentsAmount = await getDocumentsAmount(containerInstance);
				const size = getSampleDocSize(documentsAmount, recordSamplingSettings) || 1000;

				logger.progress({ message: 'Load documents...', containerName: data.database, entityName: bucketName });
				const documents = await getDocuments(containerInstance, size);
				logger.progress({
					message: 'Documents have loaded.',
					containerName: data.database,
					entityName: bucketName
				});
				const filteredDocuments = filterDocuments(documents);
				const documentKindName = data.documentKinds[collection.id].documentKindName || '*';
				const docKindsList = data.collectionData.collections[bucketName];
				const collectionPackages = [];

				if (documentKindName !== '*') {
					if (!docKindsList) {
						const documentsPackage = {
							dbName: bucketName,
							emptyBucket: true,
							indexes: [],
							bucketIndexes: indexes,
							views: [],
							validation: false,
							bucketInfo
						};
						collectionPackages.push(documentsPackage);
					} else {
						docKindsList.forEach(docKindItem => {
							const newArrayDocuments = filteredDocuments.filter(item => {
								return item[documentKindName] == docKindItem;
							});

							const documentsPackage = {
								dbName: bucketName,
								collectionName: docKindItem,
								documents: newArrayDocuments || [],
								indexes: [],
								bucketIndexes: indexes,
								views: [],
								validation: false,
								docType: documentKindName,
								bucketInfo
							};

							if (fieldInference.active === 'field') {
								documentsPackage.documentTemplate = newArrayDocuments[0] || null;
							}

							collectionPackages.push(documentsPackage);
						});
					}
				} else {
					const documentsPackage = {
						dbName: bucketName,
						collectionName: bucketName,
						documents: filteredDocuments || [],
						indexes: [],
						bucketIndexes: indexes,
						views: [],
						validation: false,
						docType: bucketName,
						bucketInfo
					};

					if (fieldInference.active === 'field') {
						documentsPackage.documentTemplate = filteredDocuments[0] || null;
					}

					collectionPackages.push(documentsPackage);
				}

				return collectionPackages;
			});

			const dbCollections = await Promise.all(dbCollectionsPromise);
			return cb(null, dbCollections, modelInfo);
		} catch(err) {
			logger.progress({
				message: 'Error of connecting to the database ' + data.database + '.\n ' + err.message,
				containerName: data.database,
				entityName: ''
			});
			logger.log('error', err);
			return cb(mapError(err));
		}
	}
};


async function getCollectionById(containerInstance) {
	const { resource: collection } = await containerInstance.read();
	return collection;
}

async function getOfferType(collection) {
	const querySpec = {
		query: 'SELECT * FROM root r WHERE  r.resource = @link',
		parameters: [
			{
				name: '@link',
				value: collection._self
			}
		]
	};
	const { resources: offer } = await client.offers.query(querySpec).fetchAll();
	return offer.length > 0 && offer[0];
}

async function getDatabasesData() {
	const dbResponse = await client.databases.readAll().fetchAll();
	return dbResponse.resources;

}

async function listCollections(databaseId) {
	const { resources: containers } = await client.database(databaseId).containers.readAll().fetchAll();
	return containers;
}

async function getDocuments(container, maxItemCount) {
	const query = `SELECT TOP ${maxItemCount} * FROM c`;
	let documents = [];
	try {
		const docRequest = container.items.query(query, { enableCrossPartitionQuery: true, maxItemCount: 200 });
		while(docRequest.hasMoreResults()) {
			const { resources: docs } = await docRequest.fetchNext();
			documents = documents.concat(docs);
		}
	} catch(err) {
		console.log(err);
		logger.log('error', err);
	}
	return documents;
}

async function getDocumentsAmount(container) {
	const query = `SELECT COUNT(1) FROM c`;
	const { resources: amount } = await container.items.query(query, { enableCrossPartitionQuery: true }).fetchAll();
	return amount[0].$1;
}

function filterDocuments(documents) {
	return documents.map(item =>{
		for(let prop in item){
			if(prop && prop[0] === '_'){
				delete item[prop];
			}
		}
		return item;
	});
}

function generateCustomInferSchema(documents, params) {
	function typeOf(obj) {
		return {}.toString.call(obj).split(' ')[1].slice(0, -1).toLowerCase();
	};

	let sampleSize = params.sampleSize || 30;

	let inferSchema = {
		"#docs": 0,
		"$schema": "http://json-schema.org/schema#",
		"properties": {}
	};

	documents.forEach(item => {
		inferSchema["#docs"]++;
		
		for(let prop in item){
			if(inferSchema.properties.hasOwnProperty(prop)){
				inferSchema.properties[prop]["#docs"]++;
				inferSchema.properties[prop]["samples"].indexOf(item[prop]) === -1 && inferSchema.properties[prop]["samples"].length < sampleSize? inferSchema.properties[prop]["samples"].push(item[prop]) : '';
				inferSchema.properties[prop]["type"] = typeOf(item[prop]);
			} else {
				inferSchema.properties[prop] = {
					"#docs": 1,
					"%docs": 100,
					"samples": [item[prop]],
					"type": typeOf(item[prop])
				}
			}
		}
	});

	for (let prop in inferSchema.properties){
		inferSchema.properties[prop]["%docs"] = Math.round((inferSchema.properties[prop]["#docs"] / inferSchema["#docs"] * 100), 2);
	}
	return inferSchema;
}

function getDocumentKindDataFromInfer(data, probability){
	let suggestedDocKinds = [];
	let otherDocKinds = [];
	let documentKind = {
		key: '',
		probability: 0	
	};

	if(data.isCustomInfer){
		let minCount = Infinity;
		let inference = data.inference.properties;

		for(let key in inference){
			if(inference[key]["%docs"] >= probability && inference[key].samples.length && typeof inference[key].samples[0] !== 'object'){
				suggestedDocKinds.push(key);

				if(data.excludeDocKind.indexOf(key) === -1){
					if(inference[key]["%docs"] >= documentKind.probability && inference[key].samples.length < minCount){
						minCount = inference[key].samples.length;
						documentKind.probability = inference[key]["%docs"];
						documentKind.key = key;
					}
				}
			} else {
				otherDocKinds.push(key);
			}
		}
	} else {
		let flavor = (data.flavorValue) ? data.flavorValue.split(',') : data.inference[0].Flavor.split(',');
		if(flavor.length === 1){
			suggestedDocKinds = Object.keys(data.inference[0].properties);
			let matсhedDocKind = flavor[0].match(/([\s\S]*?) \= "?([\s\S]*?)"?$/);
			documentKind.key = (matсhedDocKind.length) ? matсhedDocKind[1] : '';
		}
	}

	let documentKindData = {
		bucketName: data.bucketName,
		documentList: suggestedDocKinds,
		documentKind: documentKind.key,
		preSelectedDocumentKind: data.preSelectedDocumentKind,
		otherDocKinds
	};

	return documentKindData;
}

async function handleBucket(connectionInfo, collectionsIds){
	const bucketItemsPromise = collectionsIds.map(async collectionId => {
		const containerInstance = client.database(connectionInfo.database).container(collectionId);

		const documentsAmount = await getDocumentsAmount(containerInstance);
		const size = getSampleDocSize(documentsAmount, connectionInfo.recordSamplingSettings) || 1000;

		const documents = await getDocuments(containerInstance, size);
		const filteredDocuments = filterDocuments(documents);

		const documentKind = connectionInfo.documentKinds[collectionId].documentKindName || '*';
		let documentTypes = [];

		if(documentKind !== '*'){
			documentTypes = filteredDocuments.map(doc => {
				return doc[documentKind];
			});
			documentTypes = documentTypes.filter(item => Boolean(item));
			documentTypes = _.uniq(documentTypes);
		}

		return prepareConnectionDataItem(documentTypes, collectionId);
	});
	return await Promise.all(bucketItemsPromise);
}

function prepareConnectionDataItem(documentTypes, bucketName){
	let uniqueDocuments = _.uniq(documentTypes);
	let connectionDataItem = {
		dbName: bucketName,
		dbCollections: uniqueDocuments
	};

	return connectionDataItem;
}

function getSampleDocSize(count, recordSamplingSettings) {
	let per = recordSamplingSettings.relative.value;
	return (recordSamplingSettings.active === 'absolute')
		? recordSamplingSettings.absolute.value
			: Math.round( count/100 * per);
}

function getIndexes(indexingPolicy){
	const rangeIndexes = getRangeIndexes(indexingPolicy);
	const spatialIndexes = getSpatialIndexes(indexingPolicy);
	const compositeIndexes = getCompositeIndexes(indexingPolicy);

	return rangeIndexes.concat(spatialIndexes).concat(compositeIndexes);
}

function getRangeIndexes(indexingPolicy) {
	let rangeIndexes = [];
	const excludedPaths = indexingPolicy.excludedPaths.map(({ path }) => path).join(', ');
	
	if(indexingPolicy) {
		indexingPolicy.includedPaths.forEach((item, i) => {
			if (item.indexes) {
				const indexes = item.indexes.map((index, j) => {
					return {
						name: `New Index(${j+1})`,
						indexPrecision: index.precision,
						automatic: indexingPolicy.automatic,
						mode: indexingPolicy.indexingMode,
						indexIncludedPath: item.path,
						indexExcludedPath: excludedPaths,
						dataType: index.dataType,
						kind: index.kind
					};
				});
				rangeIndexes = rangeIndexes.concat(rangeIndexes, indexes);
			} else {
				const index = {
					name: `New Index(${i+1})`,
					automatic: indexingPolicy.automatic,
					mode: indexingPolicy.indexingMode,
					indexIncludedPath: item.path,
					indexExcludedPath: excludedPaths,
					kind: 'Range'
				}
				rangeIndexes.push(index);
			}
		});
	}
	return rangeIndexes;
}

function getSpatialIndexes(indexingPolicy) {
	if (!indexingPolicy.spatialIndexes) {
		return [];
	}
	return indexingPolicy.spatialIndexes.map(item => {
		return {
			name: 'Spatial index',
			automatic: indexingPolicy.automatic,
			mode: indexingPolicy.indexingMode,
			kind: 'Spatial',
			indexIncludedPath: item.path,
			dataTypes: item.types.map(type => ({ spatialType: type }))
		};
	});
}

function getCompositeIndexes(indexingPolicy) {
	if (!indexingPolicy.compositeIndexes) {
		return [];
	}
	return indexingPolicy.compositeIndexes.map(item => {
		return {
			name: 'Composite index',
			automatic: indexingPolicy.automatic,
			mode: indexingPolicy.indexingMode,
			kind: 'Composite',
			compositeFields: item.map(({ order, path }) => ({ compositeFieldPath: path, compositeFieldOrder: order }))
		};
	});
}

function getPartitionKey(collection) {
	if (!collection.partitionKey) {
		return '';
	}
	if (!Array.isArray(collection.partitionKey.paths)) {
		return '';
	}
	
	return collection.partitionKey.paths.join(',');
}

function getUniqueKeys(collection) {
	if (!collection.uniqueKeyPolicy) {
		return [];
	}

	if (!Array.isArray(collection.uniqueKeyPolicy.uniqueKeys)) {
		return [];
	}

	return collection.uniqueKeyPolicy.uniqueKeys.map(item => {
		if (!Array.isArray(item.paths)) {
			return;
		}

		return {
			attributePath: item.paths.join(',')
		};
	}).filter(Boolean);
}

function getOfferProps(offer) {
	const isAutopilotOn = _.get(offer, 'content.offerAutopilotSettings');
	if (isAutopilotOn) {
		return {
			autopilot: true,
			throughput: offer.content.offerAutopilotSettings.maximumTierThroughput
		};
	}
	return {
		autopilot: false,
		throughput: offer ? offer.content.offerThroughput : ''
	};
}

async function getStoredProcedures(containerInstance) {
	const { resources } = await containerInstance.scripts.storedProcedures.readAll().fetchAll();
	return resources.map((item, i) => {
		return {
			storedProcID: item.id,
			name: `New Stored procedure(${i+1})`,
			storedProcFunction: item.body
		};
	});
}

async function getTriggers(containerInstance) {
	const { resources } = await containerInstance.scripts.triggers.readAll().fetchAll();
	return resources.map((item, i) => {
		return {
			triggerID: item.id,
			name: `New Trigger(${i+1})`,
			prePostTrigger: item.triggerType === 'Pre' ? 'Pre-Trigger' : 'Post-Trigger',
			triggerOperation: item.triggerOperation,
			triggerFunction: item.body
		};
	});
}

async function getUdfs(containerInstance) {
	const { resources } = await containerInstance.scripts.userDefinedFunctions.readAll().fetchAll();
	return resources.map((item, i) => {
		return {
			udfID: item.id,
			name: `New UDFS(${i+1})`,
			udfFunction: item.body
		};
	});
}

function getTTL(defaultTTL) {
	if (!defaultTTL) {
		return 'Off';
	}
	return defaultTTL === -1 ? 'On (no default)' : 'On';
}

function getSamplingInfo(recordSamplingSettings, fieldInference) {
	let samplingInfo = {};
	let value = recordSamplingSettings[recordSamplingSettings.active].value;
	let unit = (recordSamplingSettings.active === 'relative') ? '%' : ' records max';
	samplingInfo.recordSampling = `${recordSamplingSettings.active} ${value}${unit}`
	samplingInfo.fieldInference = (fieldInference.active === 'field') ? 'keep field order' : 'alphabetical order';
	return samplingInfo;
}

function getEndpoint(data) {
	const hostWithPort = /:\d+/;
	if (hostWithPort.test(data.host)) {
		return data.host;
	}
	if (data.port) {
		return data.host + ':' + (data.port || '443');
	}
}

function setUpDocumentClient(connectionInfo) {
	const endpoint = getEndpoint(connectionInfo);
	const key = connectionInfo.accountKey;
	if ((connectionInfo.disableSSL)) {
		process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
	}
	return new CosmosClient({ endpoint, key });
}

async function getAdditionalAccountInfo(connectionInfo, logger) {
	if (connectionInfo.disableSSL || !connectionInfo.includeAccountInformation) {
		return {};
	}

	logger.log('info', {}, 'Account additional info', connectionInfo.hiddenKeys);

	try {
		const { clientId, appSecret, tenantId, subscriptionId, resourceGroupName, host } = connectionInfo;
		const accNameRegex = /https:\/\/(.+)\.documents.+/i;
		const accountName = accNameRegex.test(host) ? accNameRegex.exec(host)[1] : '';
		const tokenBaseURl = `https://login.microsoftonline.com/${tenantId}/oauth2/token`;
		const { data: tokenData } = await axios({
			method: 'post',
			url: tokenBaseURl,
			data: qs.stringify({
				grant_type: 'client_credentials',
				client_id: clientId,
				client_secret: appSecret,
				resource: 'https://management.azure.com/'
			}),
			headers: {
				'Content-Type': 'application/x-www-form-urlencoded'
			}
		});
		const dbAccountBaseUrl = `https://management.azure.com/subscriptions/${subscriptionId}/resourceGroups/${resourceGroupName}/providers/Microsoft.DocumentDB/databaseAccounts/${accountName}?api-version=2015-04-08`;
		const { data: accountData } = await axios({
			method: 'get',
			url: dbAccountBaseUrl,
			headers: {
				'Authorization': `${tokenData.token_type} ${tokenData.access_token}`
			}
		});
		logger.progress({
			message: 'Getting account information',
			containerName: connectionInfo.database
		});
		return {
			enableMultipleWriteLocations: accountData.properties.enableMultipleWriteLocations,
			enableAutomaticFailover: accountData.properties.enableAutomaticFailover,
			isVirtualNetworkFilterEnabled: accountData.properties.isVirtualNetworkFilterEnabled,
			virtualNetworkRules: accountData.properties.virtualNetworkRules.map(({ id, ignoreMissingVNetServiceEndpoint }) => ({
				virtualNetworkId: id,
				ignoreMissingVNetServiceEndpoint
			})),
			ipRangeFilter: accountData.properties.ipRangeFilter,
			tags: Object.entries(accountData.tags).map(([tagName, tagValue]) => ({ tagName, tagValue })),
			locations: accountData.properties.locations.map(({ id, locationName, failoverPriority, isZoneRedundant }) => ({
				locationId: id,
				locationName,
				failoverPriority,
				isZoneRedundant
			}))
		};
	} catch(err) {
		logger.log('error', { message: _.get(err, 'response.data.error.message', err.message), stack: err.stack });
		logger.progress({
			message: 'Error while getting account information',
			containerName: connectionInfo.database
		});
		return {};
	}
}

function mapError(error) {
	return {
		message: error.message,
		stack: error.stack
	};
}