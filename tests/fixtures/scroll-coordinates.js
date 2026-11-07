/** 读取真实滚动节点与覆盖层坐标，供桌面拖动核验。 */
(() => {
	const t = document.getElementById('preview');
	const h = t.querySelector('.tabulator-tableholder');
	return {
		holder: h.getBoundingClientRect().toJSON(),
		left: h.scrollLeft,
		top: h.scrollTop,
		bars: [
			...t.querySelectorAll('.os-scrollbar'),
		].map(b => ({
			cls: b.className,
			style: { position: getComputedStyle(b).position, pointer: getComputedStyle(b).pointerEvents, opacity: getComputedStyle(b).opacity },
			rect: b.getBoundingClientRect().toJSON(),
			handle: b.querySelector('.os-scrollbar-handle').getBoundingClientRect().toJSON(),
		})),
	};
})();
