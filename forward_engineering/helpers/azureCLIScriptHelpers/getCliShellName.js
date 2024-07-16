/**
 * @param {object} targetScriptOptions
 * @returns {string}
 */
const getCliShellName = (targetScriptOptions = {}) => {
	const keyword = targetScriptOptions.keyword ?? '';
	const [, shellName = ''] = keyword.split('azureCli');

	return shellName.toLowerCase();
};

module.exports = { getCliShellName };
