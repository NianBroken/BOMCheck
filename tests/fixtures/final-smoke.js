/**
 * 真实扩展窗口的只读冒烟表达式，返回页面初始状态及实际内联脚本摘要。
 * 摘要使用浏览器加密接口计算，供安装包与正在运行的窗口核对是否为同一脚本。
 */
/** 计算真实内联脚本摘要，并读取初次打开的默认配置。 */
(async () => {
	/**
	 * 按实际运行脚本中的控件标识选择对应内联资源，缺失时明确失败。
	 */
	const script = [...document.scripts].find(script => script.textContent.includes('separatorHint') && script.textContent.includes('ignoreCase'));
	if (!script)
		throw new Error('没有找到扩展运行脚本');
	/**
	 * 按 UTF-8 编码实际脚本文本，SHA-256 返回字节再转换成补足两位的十六进制。
	 */
	const bytes = new TextEncoder().encode(script.textContent);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	const sha = [
		...new Uint8Array(digest),
	].map(value => value.toString(16).padStart(2, '0')).join('');
	/**
	 * 返回标题、当前面板数量、默认大小写及分隔符配置，不写入界面或工程状态。
	 */
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
