/** 使用实际可见菜单元素执行测试导航。 */
(() => {
	[
		...document.querySelectorAll('span'),
	].find(e => e.textContent === '打开物料核对').click();
	return true;
})();
