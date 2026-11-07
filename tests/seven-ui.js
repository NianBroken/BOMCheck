/**
 * 在已打开的真实扩展页面直接运行的异步验收表达式。
 * 检查初始七页、空表、分隔草稿、任务锁与面板宽度，测试结束恢复默认有效分隔符。
 */
/** 在真实内联窗口核验页面结构、空数据、分隔符草稿和操作锁。 */
(async () => {
	/**
	 * 每个断言通过后记录说明，返回数量便于区分完整执行与中途失败。
	 */
	const checks = [];
	const $ = id => document.getElementById(id);
	/**
	 * 采用二十秒截止时间等待条件，超时抛错，不无限轮询未达成的界面状态。
	 */
	const wait = async (condition) => {
		const deadline = Date.now() + 20000;
		while (!condition()) {
			if (Date.now() > deadline)
				throw new Error('页面状态等待超时');
			await new Promise(resolve => setTimeout(resolve, 50));
		}
	};
	/**
	 * 断言失败立即终止表达式，通过时才把实际验证项加入 checks。
	 */
	const assert = (condition, message) => {
		if (!condition)
			throw new Error(message);
		checks.push(message);
	};
	await wait(() => !$('refresh').disabled);
	/**
	 * 七页文字与顺序为当前界面契约，逐项核对真实标签节点。
	 */
	const names = [
		'导入设置',
		'数据预览',
		'工程独有',
		'清单独有',
		'属性填充',
		'问题明细',
		'操作日志',
	];
	assert(JSON.stringify([
		...document.querySelectorAll('[role=tab]'),
	].map(tab => tab.textContent)) === JSON.stringify(names), '七页名称及顺序正确');
	assert(names.every(name => /^\p{Script=Han}{4}$/u.test(name)), '所有标签恰好四个汉字');
	assert(!$('panel-file').querySelector('#preview,details') && $('preview').closest('section') === $('panel-preview'), '原始预览为独立页面');
	assert(document.querySelectorAll('.page-note').length === 7 && !document.querySelector('.hint,.caption,#bomPreview'), '七页仅保留统一说明位置');
	assert($('ignoreCase').checked, '默认忽略位号大小写');
	/**
	 * 创建空草稿后继续添加应禁用，离开编辑页时空草稿移除且有效配置保留。
	 */
	const count = () => $('separators').querySelectorAll('input').length;
	$('addSeparator').click();
	assert(count() === 4 && $('addSeparator').disabled, '空行存在时禁用继续添加');
	$('addSeparator').click();
	assert(count() === 4, '重复点击不产生第二个空行');
	$('tab-preview').click();
	assert(count() === 3 && !$('addSeparator').disabled, '离开编辑页释放空行');
	await wait(() => $('preview').querySelector('.tabulator-placeholder'));
	assert(getComputedStyle($('preview').querySelector('.tabulator-header')).display === 'none', '空表格不显示无用途表头');
	assert($('preview').classList.contains('empty-table'), '空表格采用紧凑状态');
	$('tab-file').click();
	$('addSeparator').click();
	let draft = $('separators').querySelector('input:last-of-type');
	draft = $('separators').lastElementChild.querySelector('input');
	/**
	 * 普通空格与多字符均为字面位号分隔符，与属性合并分隔符的可见字符规则不同。
	 */
	draft.value = ' ';
	draft.dispatchEvent(new Event('input', { bubbles: true }));
	assert(!$('addSeparator').disabled, '空格保留为有效字面分隔符');
	$('addSeparator').click();
	draft = $('separators').lastElementChild.querySelector('input');
	draft.value = '||';
	draft.dispatchEvent(new Event('input', { bubbles: true }));
	$('tab-mapping').click();
	assert(count() === 5, '离页保留空格和多字符分隔符');
	const heading = $('panel-mapping').querySelector('h2').getBoundingClientRect();
	const checkbox = $('clearEmpty').closest('label').getBoundingClientRect();
	const actions = $('panel-mapping').querySelector('.mapping-actions').getBoundingClientRect();
	assert(checkbox.top >= heading.bottom && actions.top >= checkbox.bottom, '标题复选框按钮行按顺序纵向排列');
	assert(!$('panel-mapping').querySelector('.mapping-actions input'), '按钮行不混入复选框');
	$('tab-file').click();
	$('resetSeparators').click();
	$('addSeparator').click();
	$('refresh').click();
	assert(count() === 3 && $('addSeparator').disabled, '进入异步操作前清理草稿并锁定按钮');
	await wait(() => !$('refresh').disabled);
	assert(!$('addSeparator').disabled, '异步操作结束恢复正确添加状态');
	$('addSeparator').click();
	$('separators').lastElementChild.querySelector('button').click();
	assert(count() === 3 && !$('addSeparator').disabled, '删除草稿后恢复添加');
	/**
	 * 逐页切换核对唯一说明和可用宽度，覆盖滚动条不应占据正文列宽。
	 */
	for (const button of document.querySelectorAll('[role=tab]')) {
		button.click();
		const panel = $(button.getAttribute('aria-controls'));
		await new Promise(resolve => setTimeout(resolve, 100));
		assert(!panel.hidden && panel.querySelectorAll('.page-note').length === 1, `${button.textContent}说明不重复`);
		assert(panel.offsetWidth - panel.clientWidth === 2, `${button.textContent}滚动条不占宽度`);
	}
	$('tab-file').click();
	assert(document.querySelectorAll('#separators input').length === 3, '最终配置仅有三个有效分隔符');
	return {
		checks,
		count: checks.length,
		version: globalThis.eda.sys_Environment.getEditorCurrentVersion(),
	};
})();
