const { generateScript } = require('./generateScript');
const { generateContainerScript } = require('./generateContainerScript');
const { applyToInstance, testConnection } = require('./applyToInstance');

module.exports = {
	generateScript,
	generateContainerScript,
	applyToInstance,
	testConnection,
};
