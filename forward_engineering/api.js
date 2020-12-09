const getIndexPolicyScript = require('./helpers/getIndexPolicyScript');

module.exports = {
	generateContainerScript(data, logger, callback, app) {
		try {
			const _ = app.require('lodash');
			const script = getIndexPolicyScript(_)(data.containerData)
			return callback(null, JSON.stringify(script, null, 2));
		} catch (e) {
			const error = { message: e.message, stack: e.stack };
			logger.log('error', error, 'CosmosDB w\\ SQL API forward engineering error');
			callback(error);
		}
	}
};
