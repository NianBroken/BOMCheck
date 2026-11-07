/** 计算真实内联脚本摘要，并读取初次打开的默认配置。 */
(async () => {
	const script = [...document.scripts].find(script => script.textContent.includes('separatorHint') && script.textContent.includes('ignoreCase'));
	if (!script)
		throw new Error('没有找到扩展运行脚本');
	const bytes = new TextEncoder().encode(script.textContent);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const sha = [
		...new Uint8Array(digest),
	].map(value => value.toString(16).padStart(2, '0')).join('');
	return {
		title: document.title,
		defaultFilePage: !document.getElementById('panel-file').hidden,
		visiblePanels: [
			...document.querySelectorAll('[role=tabpanel]'),
		].filter(panel => !panel.hidden).length,
		ignoreCase: document.getElementById('ignoreCase').checked,
		separators: [
			...document.querySelectorAll('#separators input'),
		].map(input => input.value),
		scriptSha256: sha,
		status: document.getElementById('status').textContent,
	};
})();
