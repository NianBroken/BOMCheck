/** 在真实扩展窗口验证标签页、分隔符与交互状态，不构造替代宿主。 */
(async () => {
	const checks = [];
	const $ = id => document.getElementById(id);
	const wait = async (condition) => {
		const deadline = Date.now() + 15000;
		while (!condition()) {
			if (Date.now() > deadline)
				throw new Error('页面状态等待超时');
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	};
	const assert = (condition, message) => {
		if (!condition)
			throw new Error(message);
		checks.push(message);
	};
	const visible = () => [
		...document.querySelectorAll('[role=tabpanel]'),
	].filter(panel => !panel.hidden).map(panel => panel.id);
	assert(JSON.stringify(visible()) === '["panel-file"]', '默认只显示文件页');
	assert($('ignoreCase').checked, '忽略大小写默认启用');
	assert(!document.querySelector('header,footer,#backup,#version'), '品牌横幅页脚版本展示和备份入口已移除');
	assert($('summary').textContent.includes('匹配 479'), '真实参考BOM匹配479个器件');
	const summary = $('summary').textContent;
	$('tab-mapping').click();
	$('addMapping').click();
	await wait(() => $('mappings').children.length === 1);
	const source = $('mappings').querySelectorAll('select')[0];
	const target = $('mappings').querySelectorAll('select')[1];
	source.value = 'col:4';
	target.value = 'other:Description';
	// 目标标识从当前真实字段列表选择，保留各宿主的实际字段定义。
	if (!target.value)
		target.value = [...target.options].find(option => option.textContent === '更多属性 / 描述').value;
	source.dispatchEvent(new Event('change'));
	target.dispatchEvent(new Event('change'));
	const selected = [source.value, target.value];
	$('tab-bom').click();
	await wait(() => $('bomOnly').querySelector('.tabulator-header-filter input'));
	const table = $('bomOnly');
	const filter = table.querySelector('.tabulator-header-filter input');
	filter.value = '贴';
	filter.dispatchEvent(new KeyboardEvent('keyup', { key: 'T', code: 'KeyT', bubbles: true }));
	await new Promise(resolve => setTimeout(resolve, 400));
	const headers = table.querySelector('.tabulator-header');
	$('tab-operation').click();
	$('tab-bom').click();
	await wait(() => table.querySelector('.tabulator-header-filter input'));
	assert(table.querySelector('.tabulator-header') === headers, '标签切换保留表格实例和列');
	assert(table.querySelector('.tabulator-header-filter input').value === '贴', '标签切换保留筛选输入');
	$('tab-mapping').click();
	assert(source.isConnected && source.value === selected[0] && target.value === selected[1], '标签切换保留映射选择与DOM');
	for (const id of [
		'preview',
		'project',
		'bom',
		'mapping',
		'issues',
		'operation',
		'file',
	]) {
		$(`tab-${id}`).click();
		assert(JSON.stringify(visible()) === JSON.stringify([`panel-${id}`]), `标签${id}仅显示对应面板`);
	}
	assert($('summary').textContent === summary, '切换不重新核对或丢失结果');
	$('addSeparator').click();
	const empty = $('separators').lastElementChild;
	assert($('summary').textContent === summary && !empty.querySelector('input').value, '添加空行不使有效结果失效');
	empty.querySelector('button').click();
	assert($('summary').textContent === summary, '删除空行不改变解析配置');
	$('addSeparator').click();
	const duplicate = $('separators').lastElementChild;
	duplicate.querySelector('input').value = ',';
	duplicate.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
	assert($('separatorHint').textContent.includes('重复 1') && $('summary').textContent === summary, '重复分隔符提示一致且不重复失效');
	duplicate.querySelector('input').value = '||';
	duplicate.querySelector('input').dispatchEvent(new Event('input', { bubbles: true }));
	assert($('summary').textContent.includes('重新核对') && $('export').disabled, '有效分隔符变化使旧结果失效');
	assert([
		...$('separators').children,
	].every(row => row.querySelectorAll('input').length === 1), '每行只包含一个分隔符输入框');
	$('resetSeparators').click();
	assert(JSON.stringify([
		...$('separators').querySelectorAll('input'),
	].map(input => input.value)) === '[",","，","、"]', '恢复三种默认分隔符');
	for (const button of [
		...$('separators').querySelectorAll('button'),
	]) button.click();
	assert(!$('separators').children.length && $('separatorHint').textContent.includes('有效 0'), '删除全部行进入无分隔符模式');
	$('resetSeparators').click();
	$('ignoreCase').click();
	$('tab-issues').click();
	$('tab-file').click();
	$('refresh').click();
	await wait(() => !$('refresh').disabled);
	assert(!$('ignoreCase').checked, '手动关闭大小写选项在切页和刷新后保持');
	$('ignoreCase').click();
	return {
		version: globalThis.eda.sys_Environment.getEditorCurrentVersion(),
		checks,
		count: checks.length,
	};
})();
