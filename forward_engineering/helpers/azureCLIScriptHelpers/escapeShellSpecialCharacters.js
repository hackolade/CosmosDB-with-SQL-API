const getEscapeFunction = shell => {
	switch (shell) {
		case 'powershell':
			return string => {
				string = string
					.replace(/[\u009B\u001B\u0008\0]/gu, '')
					.replace(/\r(?!\n)/gu, '')
					.replace(/(['‛‘’‚])/gu, '$1$1');

				if (/[\u0085\s]/u.test(string)) {
					string = string.replace(/(?<!\\)(\\*)"/gu, '$1$1""').replace(/(?<!\\)(\\+)$/gu, '$1$1');
				} else {
					string = string.replace(/(?<!\\)(\\*)"/gu, '$1$1\\"');
				}
				return string;
			};
		case 'bash':
		case 'zsh':
			return string => {
				return string
					.replace(/[\0\u0008\u001B\u009B]/gu, '')
					.replace(/\r(?!\n)/gu, '')
					.replace(/'/gu, "'\\''");
			};
		default:
			return string => string;
	}
};

const wrapInSingleQuotes = string => `'${string}'`;

module.exports = { getEscapeFunction, wrapInSingleQuotes };
