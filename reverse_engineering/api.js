'use strict';

const documentClient = require("documentdb").DocumentClient;
const lib = require("./node_modules/documentdb/lib/");
const documentBase = lib.DocumentBase;
const async = require('async');
const _ = require('lodash');
var client;

module.exports = {
	connect: function(connectionInfo, logger, cb){
		cb()
	},

	disconnect: function(connectionInfo, logger, cb){
		cb()
	},

	testConnection: function(connectionInfo, logger, cb){
		logger.clear();
		let timeoutResponse = setTimeout(() => {
			timeoutResponse = null;
			return cb(true);

		}, 10000);

		this.getDatabases(connectionInfo, logger, (err, data) => {
			if (timeoutResponse) {
				clearTimeout(timeoutResponse);
				
				if(err){
					return cb(true);
				} else {
					return cb(false);
				}
			} 
		});
	},

	getDatabases: function(connectionInfo, logger, cb){
		client = setUpDocumentClient(connectionInfo);
		logger.clear();
		logger.log('info', connectionInfo, 'Reverse-Engineering connection settings', connectionInfo.hiddenKeys);

		listDatabases((err, dbs) => {
			if(err){
				logger.log('error', err);
				return cb(err);
			} else {
				dbs = dbs.map(item => item.id);
				logger.log('info', dbs, 'All databases list', connectionInfo.hiddenKeys);
				return cb(err, dbs);
			}
		});
	},

	getDocumentKinds: function(connectionInfo, logger, cb) {
		client = setUpDocumentClient(connectionInfo);
		logger.log('info', connectionInfo, 'Reverse-Engineering connection settings', connectionInfo.hiddenKeys);

		readDatabaseById(connectionInfo.database, (err, database) => {
			if(err){
				console.log(err);
				logger.log('error', err);
			} else {
				listCollections(database._self, (err, collections) => {
					if(err){
						console.log(err);
						logger.log('error', err);
						return dbItemCallback(err)
					} else {
						logger.log('collections list', collections, 'Mapped collection list');
						async.map(collections, (collectionItem, collItemCallback) => {
							readCollectionById(database.id, collectionItem.id, (err, collection) => {
								let amount = 1000;
								if(err){
									console.log(err);
									logger.log('error', err);
								} else {
									documentsAmount(collection._self, (err, result) => {
										if(err){
											// console.log(err);
											// logger.log('error', err);
											// return collItemCallback(err, null);
										} else {
											amount = result[0].$1;
										}
										let size = getSampleDocSize(amount, connectionInfo.recordSamplingSettings) || 1000;
										logger.log('info', { collectionItem: collectionItem }, 'Getting documents for current collectionItem', connectionInfo.hiddenKeys);

										listDocuments(collection._self, size, (err, documents) => {
											if(err){
												console.log(err);
												logger.log('error', err);
												return collItemCallback(err, null);
											} else {
												documents  = filterDocuments(documents);

												let inferSchema = generateCustomInferSchema(collectionItem.id, documents, { sampleSize: 20 });
												let documentsPackage = getDocumentKindDataFromInfer({ bucketName: collectionItem.id,
													inference: inferSchema, isCustomInfer: true, excludeDocKind: connectionInfo.excludeDocKind }, 90);

												return collItemCallback(err, documentsPackage);
											}
										});
									});
								}
							});
						}, (err, items) => {
							if(err){
								logger.log('error', err);
								console.log(err);
							}
							return cb(err, items);
						});
					}
				});
			}
		});
	},

	getDbCollectionsNames: function(connectionInfo, logger, cb) {
		client = setUpDocumentClient(connectionInfo);
		logger.log('info', connectionInfo, 'Reverse-Engineering connection settings', connectionInfo.hiddenKeys);

		readDatabaseById(connectionInfo.database, (err, database) => {
			if(err){
				console.log(err);
				logger.log('error', err);
				return cb(err)
			} else {
				logger.log('info', { Database: database.id }, 'Getting collections list for current database', connectionInfo.hiddenKeys);
				listCollections(database._self, (err, collections) => {
					if(err){
						console.log(err);
						logger.log('error', err);
						return cb(err)
					} else {
						let collectionNames = collections.map(item => item.id);
						logger.log('info', { CollectionList: collections }, 'Collection list for current database', connectionInfo.hiddenKeys);
						handleBucket(connectionInfo, collectionNames, database, cb);
					}
				});
			}
		});
	},

	getDbCollectionsData: function(data, logger, cb){
		client = setUpDocumentClient(data);
		logger.log('info', data, 'Reverse-Engineering connection settings', data.hiddenKeys);

		let includeEmptyCollection = data.includeEmptyCollection;
		let { recordSamplingSettings, fieldInference } = data;
		logger.log('info', getSamplingInfo(recordSamplingSettings, fieldInference), 'Reverse-Engineering sampling params', data.hiddenKeys);

		let bucketList = data.collectionData.dataBaseNames;

		logger.log('info', { CollectionList: bucketList }, 'Selected collection list', data.hiddenKeys);

		readDatabaseById(data.database, (err, database) => {
			if(err){
				console.log(err);
				logger.log('error', err);
				return cb(err)
			} else {
				let modelInfo = {
					dbId: database.id,
					accountID: data.accountKey
				};

				client.getDatabaseAccount((err, accountInfo, accountInfo2) => {
					if(err){
						console.log(err);
						logger.log('error', err);
					} else{
						modelInfo.defaultConsistency = accountInfo.ConsistencyPolicy.defaultConsistencyLevel;
						modelInfo.preferredLocation = (accountInfo.WritableLocations[0]) ? accountInfo.WritableLocations[0].name : '';

						logger.log('info', modelInfo, 'Model info', data.hiddenKeys);

						async.map(bucketList, (bucketName, collItemCallback) => {
							readCollectionById(database.id, bucketName, (err, collection) => {
								if(err){
									console.log(err);
									logger.log('error', err);
									return collItemCallback(err);
								} else {
									getOfferType(collection, (err, info) => {
										if(err){
											console.log(err);
											logger.log('error', err);
											return collItemCallback(err);
										} else {
											let bucketInfo = {
												throughput: info.content.offerThroughput,
												rump: info.content.offerIsRUPerMinuteThroughputEnabled ? 'OFF' : 'On',
												partitionKey: getPartitionKey(collection),
												uniqueKey: getUniqueKeys(collection)
		 									};

		 									let indexes = getIndexes(collection.indexingPolicy);

		 									let amount = 1000;
		 									documentsAmount(collection._self, (err, result) => {
		 										if(err){
		 											// console.log(err);
		 											// logger.log('error', err);
		 											// return collItemCallback(err, null);
		 										} else {
		 											amount = result[0].$1;
		 										}
	 											let size = getSampleDocSize(amount, recordSamplingSettings) || 1000;

												listDocuments(collection._self, size, (err, documents) => {
													if(err){
														console.log(err);
														logger.log('error', err);
														return collItemCallback(err);
													} else {
														documents = filterDocuments(documents);
														let documentKindName = data.documentKinds[collection.id].documentKindName || '*';
														let docKindsList = data.collectionData.collections[bucketName];
														let collectionPackages = [];

														if(documentKindName !== '*'){
															if(!docKindsList){
																let documentsPackage = {
																	dbName: bucketName,
																	emptyBucket: true,
																	indexes: [],
																	bucketIndexes: indexes,
																	views: [],
																	validation: false,
																	bucketInfo
																};
																collectionPackages.push(documentsPackage)
															} else {
																docKindsList.forEach(docKindItem => {
																	let newArrayDocuments = documents.filter((item) => {
																		return item[documentKindName] == docKindItem;
																	});

																	let documentsPackage = {
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

																	if(fieldInference.active === 'field'){
																		documentsPackage.documentTemplate = newArrayDocuments[0] || null;
																	}

																	collectionPackages.push(documentsPackage)
																});
															}
														} else {
															let documentsPackage = {
																dbName: bucketName,
																collectionName: bucketName,
																documents: documents || [],
																indexes: [],
																bucketIndexes: indexes,
																views: [],
																validation: false,
																docType: bucketName,
																bucketInfo
															};

															if(fieldInference.active === 'field'){
																documentsPackage.documentTemplate = documents[0] || null;
															}

															collectionPackages.push(documentsPackage)
														}

														return collItemCallback(err, collectionPackages);
													}
												});
		 									});

										}
									})
								}
							});
						}, (err, items) => {
							if(err){
								console.log(err);
								logger.log('error', err);
							}
							return cb(err, items, modelInfo);
						});
					}
				})

			}
		});
	}
};


function readCollectionById(dbLink, collectionId, callback) {
	var collLink = `dbs/${dbLink}/colls/${collectionId}`;

	client.readCollection(collLink, function (err, coll) {
		if (err) {
			return callback(err);
		} else {
			return callback(null, coll);
		}
	});
}

function getOfferType(collection, callback) {
	var querySpec = {
		query: 'SELECT * FROM root r WHERE  r.resource = @link',
		parameters: [
			{
				name: '@link',
				value: collection._self
			}
		]
	};

	client.queryOffers(querySpec).toArray(function (err, offers) {
		if (err) {
			return callback(err);
		} else if (offers.length === 0) {
			return callback('No offer found for collection');
		} else {
			var offer = offers[0];
			return callback(null, offer);
		}
	});
}

function listDatabases(callback) {
	var queryIterator = client.readDatabases().toArray(function (err, dbs) {
		if (err) {
			return callback(err);
		}
		return callback(null, dbs);
	});
}

function listCollections(databaseLink, callback) {
	var queryIterator = client.readCollections(databaseLink).toArray(function (err, cols) {
		if (err) {
			return callback(err);
		} else {            
			return callback(null, cols);
		}
	});
}

function readDatabaseById(databaseId, callback) {
	client.readDatabase('dbs/' + databaseId, function (err, db) {
		if (err) {
			return callback(err);
		} else {
			return callback(null, db);
		}
	});
}

function listDocuments(collLink, maxItemCount, callback) {
	const query = {
		"query": `SELECT TOP ${maxItemCount} * FROM c`
	};

	var queryIterator = client.queryDocuments(collLink, query, { enableCrossPartitionQuery: true }).toArray(function (err, docs) {
		if (err) {
			return callback(err);
		} else {
			return callback(null, docs);
		}
	});
}

function documentsAmount(collLink, callback) {
	const query = {
			"query": `SELECT COUNT(1) FROM c`
	};

	var queryIterator = client.queryDocuments(collLink, query, { enableCrossPartitionQuery: true }).toArray(function (err, docs) {
		if (err) {
			return callback(err);
		} else {
			return callback(null, docs);
		}
	});
}

function filterDocuments(documents){
	return documents.map(item =>{
		for(let prop in item){
			if(prop && prop[0] === '_'){
				delete item[prop];
			}
		}
		return item;
	});
}

function generateCustomInferSchema(bucketName, documents, params){
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

function handleBucket(connectionInfo, collectionNames, database, dbItemCallback){
	async.map(collectionNames, (collectionName, collItemCallback) => {
		readCollectionById(database.id, collectionName, (err, collection) => {
			if(err){
				console.log(err);
				logger.log('error', err);
				collItemCallback(err);
			} else {
				let amount = 1000;
				documentsAmount(collection._self, (err, result) => {
					if(err){
						// console.log(err);
						// logger.log('error', err);
						// return collItemCallback(err, null);
					} else {
						amount = result[0].$1;
					}
					let size = getSampleDocSize(amount, connectionInfo.recordSamplingSettings) || 1000;

					listDocuments(collection._self, size, (err, documents) => {
						if(err){
							console.log(err);
							return collItemCallback(err);
						} else {
							documents  = filterDocuments(documents);
							let documentKind = connectionInfo.documentKinds[collection.id].documentKindName || '*';
							let documentTypes = [];

							if(documentKind !== '*'){
								documentTypes = documents.map(function(doc){
									return doc[documentKind];
								});
								documentTypes = documentTypes.filter((item) => Boolean(item));
								documentTypes = _.uniq(documentTypes);
							}

							let dataItem = prepareConnectionDataItem(documentTypes, collection.id, database);
							return collItemCallback(err, dataItem);
						}
					});
				});
			}
		});
	}, (err, items) => {
		if(err){
			console.log(err);
			logger.log('error', err);
		}
		return dbItemCallback(err, items);
	});
}

function prepareConnectionDataItem(documentTypes, bucketName, database){
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
			let indexes = item.indexes;
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

function getSamplingInfo(recordSamplingSettings, fieldInference){
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

function setUpDocumentClient(connectionInfo){
	let endpoint = getEndpoint(connectionInfo);
	let connectionPolicy = new documentBase.ConnectionPolicy();
	connectionPolicy.DisableSSLVerification = connectionInfo.disableSSL;
	return new documentClient(endpoint, { "masterKey": connectionInfo.accountKey }, connectionPolicy);
}