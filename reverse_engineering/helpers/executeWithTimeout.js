const executeWithTimeout = (f, timeout = 30000) =>
	new Promise((resolve, reject) => {
		const t = setTimeout(() => {
			reject(new Error('Timeout exceeded. Please check your connections settings and try again'));
		}, timeout);

		f().then(resolve).catch(reject).finally(() => clearTimeout(t))
	});

module.exports = executeWithTimeout;
