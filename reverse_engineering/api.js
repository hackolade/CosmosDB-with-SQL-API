'use strict';

const { CosmosClient } = require('@azure/cosmos');
const _ = require('lodash');
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

			const modelInfo = {
				dbId: data.database,
				accountID: data.accountKey
			};

			const { resource: accountInfo } = await client.getDatabaseAccount();

			modelInfo.defaultConsistency = accountInfo.consistencyPolicy;
			modelInfo.preferredLocation = accountInfo.writableLocations[0] ? accountInfo.writableLocations[0].name : '';

			logger.log('info', modelInfo, 'Model info', data.hiddenKeys);
			const dbCollectionsPromise = bucketList.map(async bucketName => {
				const containerInstance = client.database(data.database).container(bucketName);
				const collection = await getCollectionById(containerInstance);
				const offerInfo = await getOfferType(collection);
				const bucketInfo = {
					throughput: offerInfo ? offerInfo.content.offerThroughput : '',
					rump: offerInfo && offerInfo.content.offerIsRUPerMinuteThroughputEnabled ? 'OFF' : 'On',
					partitionKey: getPartitionKey(collection),
					uniqueKey: getUniqueKeys(collection)
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

	const { resources: documents } = await container.items.query(query, { enableCrossPartitionQuery: true }).fetchAll();
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
	let generalIndexes = [];
	
	if(indexingPolicy){
		indexingPolicy.includedPaths.forEach(item => {
			let indexes = item.indexes || [];
			indexes = indexes.map((index, i) => {
				index.name = `New Index(${i+1})`,
				index.indexPrecision = index.precision;
				index.automatic = item.automatic;
				index.mode = indexingPolicy.indexingMode;
				index.indexIncludedPath = item.path;
				return index;
			});

			generalIndexes = generalIndexes.concat(generalIndexes, indexes);
		});
	}

	return generalIndexes;
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

function getSamplingInfo(recordSamplingSettings, fieldInference) {
	let samplingInfo = {};
	let value = recordSamplingSettings[recordSamplingSettings.active].value;
	let unit = (recordSamplingSettings.active === 'relative') ? '%' : ' records max';
	samplingInfo.recordSampling = `${recordSamplingSettings.active} ${value}${unit}`
	samplingInfo.fieldInference = (fieldInference.active === 'field') ? 'keep field order' : 'alphabetical order';
	return samplingInfo;
}

function getEndpoint(data){
	return data.host + ':' + data.port;
}

function setUpDocumentClient(connectionInfo) {
	const endpoint = getEndpoint(connectionInfo);
	const key = connectionInfo.accountKey;
	if ((connectionInfo.disableSSL)) {
		process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
	}
	return new CosmosClient({ endpoint, key });
}

function mapError(error) {
	return {
		message: error.message,
		stack: error.stack
	};
}