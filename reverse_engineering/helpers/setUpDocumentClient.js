const { CosmosClient } = require('@azure/cosmos');

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
	const connectionPolicy = {
		requestTimeout: 30000
	};
	if ((connectionInfo.disableSSL)) {
		process.env["NODE_TLS_REJECT_UNAUTHORIZED"] = 0;
	}
	return new CosmosClient({ endpoint, key, connectionPolicy });
}

module.exports = setUpDocumentClient;
