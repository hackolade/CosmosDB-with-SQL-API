/**
 * @param {"bash" | "zsh" | "powershell"} shell
 * @param {string} command
 * @return {string}
 */
const escapeShellCommand = (shell, command) => {
	switch (shell) {
		case 'powershell':
			command = command
				.replace(/[\u009B\u001B\u0008\0]/gu, '') // NOSONAR
				.replace(/\r(?!\n)/gu, '')
				.replace(/(['‛‘’‚])/gu, '$1$1');

			if (/[\u0085\s]/u.test(command)) { // NOSONAR
				command = command.replace(/(?<!\\)(\\*)"/gu, '$1$1""').replace(/(?<!\\)(\\+)$/gu, '$1$1');
			} else {
				command = command.replace(/(?<!\\)(\\*)"/gu, '$1$1\\"');
			}
			return command;
		case 'bash':
		case 'zsh':
			return command
				.replace(/[\0\u0008\u001B\u009B]/gu, '') // NOSONAR
				.replace(/\r(?!\n)/gu, '')
				.replace(/'/gu, "'\\''");

		default:
			return command;
	}
};

/**
 * @param {string} command
 * @return {string}
 */
const wrapInSingleQuotes = command => `'${command}'`;

module.exports = { escapeShellCommand, wrapInSingleQuotes };
