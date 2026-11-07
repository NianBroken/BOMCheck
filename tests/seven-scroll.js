/** 使用真实BOM产生的表格验证横纵滚动、筛选空状态与弹窗覆盖层。 */
(async () => {
	const checks = [];
	const $ = id => document.getElementById(id);
	const pause = () => new Promise(resolve => setTimeout(resolve, 300));
	const assert = (condition, message) => {
		if (!condition)
			throw new Error(message);
		checks.push(message);
	};
	$('tab-preview').click();
	await pause();
	const table = $('preview');
	const holder = table.querySelector('.tabulator-tableholder');
	assert(holder.scrollWidth > holder.clientWidth, '原始数据全部列支持横向滚动');
	assert(holder.offsetWidth === holder.clientWidth && holder.offsetHeight === holder.clientHeight, '表格横纵滚动条均不占布局空间');
	holder.scrollLeft = 300;
	holder.scrollTop = 90;
	await pause();
	assert(Math.abs(table.querySelector('.tabulator-header-contents').scrollLeft - holder.scrollLeft) < 2, '横向滚动同步表头');
	const saved = [holder.scrollLeft, holder.scrollTop];
	$('tab-bom').click();
	await pause();
	$('tab-preview').click();
	await pause();
	assert(table.querySelector('.tabulator-tableholder') === holder && Math.abs(holder.scrollLeft - saved[0]) < 2 && Math.abs(holder.scrollTop - saved[1]) < 2, '切页保留原滚动节点和双向位置');
	const filter = table.querySelector('.tabulator-header-filter input');
	filter.value = '不存在的筛选结果';
	filter.dispatchEvent(new KeyboardEvent('keyup', { key: 'T', bubbles: true }));
	await new Promise(resolve => setTimeout(resolve, 500));
	assert(!table.classList.contains('empty-table') && getComputedStyle(table.querySelector('.tabulator-header')).display !== 'none', '筛选无结果保留表头及筛选条件');
	assert(table.querySelector('.tabulator-placeholder').textContent.includes('没有符合条件的记录'), '筛选空状态与未加载状态分别提示');
	filter.value = '';
	filter.dispatchEvent(new KeyboardEvent('keyup', { key: 'Backspace', bubbles: true }));
	await new Promise(resolve => setTimeout(resolve, 500));
	holder.scrollLeft = 0;
	const cell = table.querySelector('.tabulator-row .tabulator-cell');
	cell.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
	await pause();
	assert($('detail').open, '双击实际记录打开详情');
	const detail = $('detailScroll');
	assert(detail.hasAttribute('data-overlayscrollbars-viewport') && detail.offsetWidth === detail.clientWidth, '详情弹窗使用不占宽度的悬浮滚动条');
	$('closeDetail').click();
	$('tab-file').click();
	return { checks, count: checks.length };
})();
