const _ = require('lodash');
const { TTL_ON_DEFAULT, TTL_ON, TTL_OFF } = require('../../shared/constants');

const getTTL = containerData => {
	switch (containerData?.TTL) {
		case TTL_ON_DEFAULT:
			return -1;
		case TTL_ON:
			return _.parseInt(containerData?.TTLseconds) || -1;
		case TTL_OFF:
		default:
			return 0;
	}
};

module.exports = {
	getTTL,
};
