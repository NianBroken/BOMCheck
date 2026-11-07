/** 等待真实BOM读取结束后触发核对，并返回界面统计。 */
(async () => {
	const start = document.getElementById('start');
	const status = document.getElementById('status');
	const deadline = Date.now() + 45000;
	while (start.disabled) {
		if (Date.now() > deadline)
			throw new Error('BOM读取未就绪');
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	start.click();
	while (start.disabled || !status.textContent.startsWith('核对完成')) {
		if (Date.now() > deadline)
			throw new Error(`核对超时：${status.textContent}`);
		await new Promise(resolve => setTimeout(resolve, 100));
	}
	return { status: status.textContent, summary: document.getElementById('summary').textContent };
})();
