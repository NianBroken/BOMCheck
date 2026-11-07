/** 关闭当前可见的扩展管理器，不操作隐藏控件。 */
(() => {
	const button = [
		...document.querySelectorAll('button'),
	].find(e => e.textContent.trim() === '关闭' && e.getClientRects().length);
	if (button)
		button.click();
	return !!button;
})();
