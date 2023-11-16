const { wrapInSingleQuotes, escapeShellCommand } = require('./escapeShellSpecialCharacters');
const applyToInstanceHelper = require('../../applyToInstance/applyToInstanceHelper');
const { getUniqueKeyPolicyScript } = require('../getUniqueKeyPolicyScript');
const { getCliParamsDelimiter } = require('./getCliParamsDelimiter');
const getIndexPolicyScript = require('../getIndexPolicyScript');
const getPartitionKey = require('../getPartitionKey');
const {
	CLI,
	DATABASE,
	CREATE,
	CONTAINER,
	STORED_PROCEDURE,
	TRIGGER,
	USER_DEFINED_FUNCTION,
} = require('./azureCLIConstants');

const buildAzureCLIScript =
	_ =>
	({ modelData, containerData, shellName }) => {
		const cliParamsDelimiter = getCliParamsDelimiter(shellName);
		const escapeAndWrapInQuotes = string => wrapInSingleQuotes(escapeShellCommand(shellName, string));

		const accountName = escapeAndWrapInQuotes(modelData[0]?.accountName || '');
		const dbName = escapeAndWrapInQuotes(containerData[0]?.dbId || '');
		const containerName = escapeAndWrapInQuotes(containerData[0]?.name || '');
		const resourceGroup = escapeAndWrapInQuotes(modelData[0]?.resGrp || '');
		const commonParams = {
			accountName,
			dbName,
			resourceGroup,
			containerName,
			escapeAndWrapInQuotes,
			cliParamsDelimiter,
		};

		return composeCLIStatements([
			getAzureCliDbCreateStatement(commonParams),
			getAzureCliContainerCreateStatement(_)({ containerData, ...commonParams }),
			...getAzureCliStoredProcedureStatements({ containerData, ...commonParams }),
			...getAzureCliTriggerCreateStatements({ containerData, ...commonParams }),
			...getAzureCliUDFCreateStatements({ containerData, ...commonParams }),
		]);
	};

const getAzureCliDbCreateStatement = ({ accountName, dbName, resourceGroup, cliParamsDelimiter }) => {
	const cliStatement = `${CLI} ${DATABASE} ${CREATE}`;
	const requiredParams = [
		`--account-name ${accountName}`,
		`--name ${dbName}`,
		`--resource-group ${resourceGroup}`,
	].join(cliParamsDelimiter);

	return [cliStatement, requiredParams].join(cliParamsDelimiter);
};

const getAzureCliContainerCreateStatement =
	_ =>
	({ containerData, accountName, dbName, resourceGroup, containerName, escapeAndWrapInQuotes, cliParamsDelimiter }) => {
		const helper = applyToInstanceHelper(_);

		const partitionKeyParams = getPartitionKeyParams(_)(containerData);
		const throughputParam = getThroughputParam(helper.getContainerThroughputProps(containerData[0]));
		const indexingPolicyParam = `--idx ${escapeAndWrapInQuotes(
			JSON.stringify(getIndexPolicyScript(_)(containerData)),
		)}`;
		const uniqueKeysPolicyParam = getUniqueKeysPolicyParam(containerData[0], escapeAndWrapInQuotes);
		const ttl = helper.getTTL(containerData[0]);
		const ttlParam = ttl !== 0 ? `--ttl ${helper.getTTL(containerData[0])}` : '';

		const cliStatement = `${CLI} ${CONTAINER} ${CREATE}`;
		const requiredParams = [
			`--account-name ${accountName}`,
			`--database-name ${dbName}`,
			`--name ${containerName}`,
			`--resource-group ${resourceGroup}`,
			...partitionKeyParams,
		].join(cliParamsDelimiter);

		return [cliStatement, requiredParams, indexingPolicyParam, uniqueKeysPolicyParam, throughputParam, ttlParam]
			.filter(Boolean)
			.join(cliParamsDelimiter);
	};

const getAzureCliStoredProcedureStatements = ({
	containerData,
	accountName,
	dbName,
	resourceGroup,
	containerName,
	escapeAndWrapInQuotes,
	cliParamsDelimiter,
}) => {
	const cliStatement = `${CLI} ${STORED_PROCEDURE} ${CREATE}`;
	const storedProcedureStatements = (containerData[2]?.storedProcs || []).map(proc => {
		const requiredParams = [
			`--account-name ${accountName}`,
			`--database-name ${dbName}`,
			`--container-name ${containerName}`,
			`--name ${proc.storedProcID}`,
			`--resource-group ${resourceGroup}`,
			`--body ${escapeAndWrapInQuotes(proc.storedProcFunction)}`,
		].join(cliParamsDelimiter);

		return [cliStatement, requiredParams].join(cliParamsDelimiter);
	});

	return storedProcedureStatements;
};

const getAzureCliTriggerCreateStatements = ({
	containerData,
	accountName,
	dbName,
	resourceGroup,
	containerName,
	escapeAndWrapInQuotes,
	cliParamsDelimiter,
}) => {
	const cliStatement = `${CLI} ${TRIGGER} ${CREATE}`;
	const triggerStatements = (containerData[3]?.triggers || []).map(trigger => {
		const triggerOperation = `--operation ${trigger.triggerOperation}`;
		const triggerType = `--type ${trigger.prePostTrigger === 'Pre-Trigger' ? 'Pre' : 'Post'}`;

		const requiredParams = [
			`--account-name ${accountName}`,
			`--database-name ${dbName}`,
			`--container-name ${containerName}`,
			`--name ${trigger.triggerID}`,
			`--resource-group ${resourceGroup}`,
			`--body ${escapeAndWrapInQuotes(trigger.triggerFunction)}`,
		].join(cliParamsDelimiter);

		return [cliStatement, requiredParams, triggerOperation, triggerType].join(cliParamsDelimiter);
	});

	return triggerStatements;
};

const getAzureCliUDFCreateStatements = ({
	containerData,
	accountName,
	dbName,
	resourceGroup,
	containerName,
	escapeAndWrapInQuotes,
	cliParamsDelimiter,
}) => {
	const cliStatement = `${CLI} ${USER_DEFINED_FUNCTION} ${CREATE}`;
	const udfStatements = (containerData[4]?.udfs || []).map(udf => {
		const requiredParams = [
			`--account-name ${accountName}`,
			`--database-name ${dbName}`,
			`--container-name ${containerName}`,
			`--name ${udf.udfID}`,
			`--resource-group ${resourceGroup}`,
			`--body ${escapeAndWrapInQuotes(udf.udfFunction)}`,
		].join(cliParamsDelimiter);

		return [cliStatement, requiredParams].join(cliParamsDelimiter);
	});

	return udfStatements;
};

const getUniqueKeysPolicyParam = (containerData, escapeAndWrapInQuotes) => {
	const uniqueKeys = containerData?.uniqueKey || [];
	const uniqueKeysPolicyParam = uniqueKeys.length
		? `--unique-key-policy ${escapeAndWrapInQuotes(JSON.stringify(getUniqueKeyPolicyScript(uniqueKeys)))}`
		: '';

	return uniqueKeysPolicyParam;
};

const getPartitionKeyParams = _ => containerData => {
	const partitionKey = getPartitionKey(_)(containerData);
	if (typeof partitionKey === 'string') {
		return [`--partition-key-path ${wrapInSingleQuotes(partitionKey)}`];
	}

	if (typeof partitionKey === 'object') {
		return [
			`--partition-key-path ${wrapInSingleQuotes(partitionKey.paths[0])}`,
			`--partition-key-version ${partitionKey.version}`,
		];
	}

	return [];
};

const getThroughputParam = props => {
	if (props.hasOwnProperty('throughput')) {
		return `--throughput ${props.throughput}`;
	}

	if (props.hasOwnProperty('maxThroughput')) {
		return `--max-throughput ${props.maxThroughput}`;
	}

	return '';
};

const composeCLIStatements = (statements = []) => {
	return statements.join('\n\n');
};

module.exports = { buildAzureCLIScript };
