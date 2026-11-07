/** 读取真实滚动节点与覆盖层坐标，供桌面拖动核验。 */
(() => {
	const f = [
		...document.querySelectorAll('iframe'),
	].find(f => f.src.startsWith('blob:'));
	return {
		frame: f.getBoundingClientRect().toJSON(),
		scale: devicePixelRatio,
	};
})();
