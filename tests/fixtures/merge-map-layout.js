/** 用三个来源创建实际映射组，供响应式布局核验。 */
(() => {
	const $ = id => document.getElementById(id);
	$('tab-mapping').click();
	for (const button of [
		...$('mappings').querySelectorAll('[data-action="removeMapping"]'),
	]) button.click();
	$('addMapping').click();
	const panel = () => $('mappings').firstElementChild;
	const target = panel().querySelector('select');
	target.value = 'standard:name';
	target.dispatchEvent(new Event('change'));
	for (let i = 0; i < 3; i++) {
		if (i)
			panel().querySelector('[data-action="addSource"]').click();
		const source = panel().querySelectorAll('.mapping-source select')[i];
		source.value = `col:${i}`;
		source.dispatchEvent(new Event('change'));
	}
	panel().querySelector('textarea').value = '|';
	panel().querySelector('textarea').dispatchEvent(new Event('input'));
	return true;
})();
