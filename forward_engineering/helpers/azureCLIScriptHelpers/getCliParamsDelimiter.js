const getCliParamsDelimiter = shellName => {
	if (shellName === 'powershell') {
		return ' `\n\t';
	}
	if (['bash', 'zsh'].includes(shellName)) {
		return ' \\\n\t';
	}
	return ' ';
};

module.exports = { getCliParamsDelimiter };
