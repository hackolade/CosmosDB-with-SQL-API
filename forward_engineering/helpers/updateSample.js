const updateSample = (sample, containerData, entityData) => {
	const docType = containerData?.docTypeName;

	if (!docType) {
		return sample;
	}

	return {
		...sample,
		[docType]: entityData.code || entityData.collectionName,
	};
};

module.exports = {
	updateSample,
};
