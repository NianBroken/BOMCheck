/**
 * 真实宿主根页面中的测试表达式，只关闭当前可见的扩展管理器。
 * 没有可见关闭按钮时返回 false，不寻找隐藏控件触发副作用。
 */
/** 关闭当前可见的扩展管理器，不操作隐藏控件。 */
(() => {
	/**
	 * 按实际按钮文字和当前布局矩形筛选可见关闭按钮。
	 */
	const button = [
		...document.querySelectorAll('button'),
	].find(e => e.textContent.trim() === '关闭' && e.getClientRects().length);
	if (button)
		button.click();
	/**
	 * 返回是否发现并尝试点击目标，调用方另行核对后续菜单状态。
	 */
	return !!button;
})();
