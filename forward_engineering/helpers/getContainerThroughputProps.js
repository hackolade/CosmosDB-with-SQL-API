const getContainerThroughputProps = containerData => {
	if (containerData?.capacityMode === 'Serverless') {
		return {};
	}
	if (containerData?.autopilot) {
		return { maxThroughput: containerData.throughput || 4000 };
	}
	return { throughput: containerData?.throughput || 400 };
};

module.exports = {
	getContainerThroughputProps,
};
