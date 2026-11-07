/** 等待文件就绪后触发真实核对，避免在异步读取期间点击禁用控件。 */
(async () => {
	const $ = id => document.getElementById(id);
	$('tab-file').click();
	while ($('refresh').disabled) await new Promise(r => setTimeout(r, 40));
	if ($('start').disabled)
		throw new Error(`有效文件未就绪：${$('status').textContent}`);
	$('start').click();
	while ($('refresh').disabled) await new Promise(r => setTimeout(r, 40));
	if (!$('status').textContent.includes('器件核对已经完成'))
		throw new Error($('status').textContent);
	return $('summary').textContent;
})();
