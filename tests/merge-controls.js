/**
 * 在已经导入有效数据的真实扩展页面检查表格交互与控件状态。
 * 脚本要求当前预览存在数据列，用真实节点引用核对切页是否重建表格。
 */
/** 在真实扩展窗口验证完整列表、切页状态、四字操作及分隔符草稿。 */
(async () => {
	const $ = id => document.getElementById(id);
	const checks = [];
	/**
	 * 失败直接抛出，通过后才把检查文字加入结果数组。
	 */
	const assert = (value, text) => {
		if (!value)
			throw new Error(text);
		checks.push(text);
	};
	/**
	 * 等待任务锁解除，供该已就绪测试环境中的短操作衔接使用。
	 */
	const wait = async () => {
		while ($('refresh').disabled) await new Promise(r => setTimeout(r, 40));
	};
	await wait();
	assert([
		...document.querySelectorAll('button'),
	].every(b => /^\p{Script=Han}{4}$/u.test(b.textContent.trim())), '全部自有按钮均为四个汉字');
	assert(!document.querySelector('header,footer,#backup,#version'), '界面没有横幅页脚或备份入口');
	$('tab-preview').click();
	await new Promise(r => setTimeout(r, 150));
	/**
	 * 保存表格视口、实例节点及筛选框，后续以同一节点验证切页保留。
	 */
	const table = $('preview').querySelector('.tabulator-tableholder');
	const node = $('preview').querySelector('.tabulator-table');
	const filter = $('preview').querySelector('.tabulator-header-filter input');
	/**
	 * 向真实过滤框派发键盘事件，检查筛选空结果保留表头且采用明确提示。
	 */
	filter.value = '不会匹配的完整筛选';
	filter.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', code: 'KeyX', bubbles: true }));
	await new Promise(r => setTimeout(r, 450));
	assert(getComputedStyle($('preview').querySelector('.tabulator-header')).display !== 'none', '筛选无结果仍保留表头');
	assert($('preview').textContent.includes('没有匹配记录'), '筛选无结果采用明确状态');
	$('tab-bom').click();
	$('tab-preview').click();
	assert($('preview').querySelector('.tabulator-table') === node && filter.value === '不会匹配的完整筛选', '切页保留表格实例与筛选');
	filter.value = '';
	filter.dispatchEvent(new KeyboardEvent('keyup', { key: 'x', code: 'KeyX', bubbles: true }));
	await new Promise(r => setTimeout(r, 450));
	table.scrollLeft = Math.min(300, table.scrollWidth - table.clientWidth);
	table.scrollTop = Math.min(400, table.scrollHeight - table.clientHeight);
	await new Promise(r => setTimeout(r, 100));
	/**
	 * 记录实际横纵滚动位置，切页返回后允许小于两像素的布局舍入差异。
	 */
	const position = [table.scrollLeft, table.scrollTop];
	$('tab-issues').click();
	$('tab-preview').click();
	await new Promise(r => setTimeout(r, 120));
	assert(Math.abs(table.scrollLeft - position[0]) < 2 && Math.abs(table.scrollTop - position[1]) < 2, '切页恢复横纵滚动位置');
	$('tab-file').click();
	const count = () => $('separators').querySelectorAll('input').length;
	$('addSeparator').click();
	assert(count() === 4 && $('addSeparator').disabled, '存在空分隔符时禁止继续添加');
	$('tab-preview').click();
	assert(count() === 3, '切页清除空分隔符且保留有效配置');
	$('tab-file').click();
	/**
	 * 用户修改大小写后重载工程仍应保留该选择，结束前显式恢复初始选项。
	 */
	$('ignoreCase').checked = false;
	$('ignoreCase').dispatchEvent(new Event('change'));
	$('refresh').click();
	await wait();
	assert(!$('ignoreCase').checked, '重载工程保留用户大小写选择');
	$('ignoreCase').checked = true;
	$('ignoreCase').dispatchEvent(new Event('change'));
	/**
	 * 逐面板核对说明唯一及正文宽度，最后确认没有基础记录的工程差异隐藏空表头。
	 */
	for (const tab of document.querySelectorAll('[role=tab]')) {
		tab.click();
		await new Promise(r => setTimeout(r, 80));
		const panel = $(tab.getAttribute('aria-controls'));
		assert(!panel.hidden && panel.querySelectorAll('.page-note').length === 1, `${tab.textContent}只展示一条页面说明`);
		assert(panel.offsetWidth - panel.clientWidth === 2, `${tab.textContent}滚动条不占正文宽度`);
	}
	$('tab-project').click();
	await new Promise(r => setTimeout(r, 100));
	assert(getComputedStyle($('projectOnly').querySelector('.tabulator-header')).display === 'none', '无基础记录时隐藏空表头');
	$('tab-file').click();
	return { checks, count: checks.length };
})();
