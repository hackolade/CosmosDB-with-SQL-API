
const executeWithTimeout = (f, timeout = 30000) => new Promise(async (resolve, reject) => {
	const t = setTimeout(async () => {
		reject(new Error('Timeout exceeded. Please check your connections settings and try again'));	
	}, timeout);

	try {
		const result = await f();

		resolve(result);
	} catch (error) {
		reject(error);
	} finally {
		clearTimeout(t);
	}
});

module.exports = executeWithTimeout;
