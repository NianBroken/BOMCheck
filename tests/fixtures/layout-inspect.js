/** 记录实际内容尺寸、面板溢出和主要操作位置。 */
(() => ({
	size: [innerWidth, innerHeight],
	pageOverflow: document.documentElement.scrollWidth > innerWidth,
	visible: [
		...document.querySelectorAll('[role=tabpanel]'),
	].filter(e => !e.hidden).map(e => ({
		id: e.id,
		width: e.clientWidth,
		scrollWidth: e.scrollWidth,
		height: e.clientHeight,
		scrollHeight: e.scrollHeight,
	})),
	tabs: [
		...document.querySelectorAll('[role=tab]'),
	].map(e => ({
		text: e.textContent,
		rect: e.getBoundingClientRect().toJSON(),
	})),
	start: document.getElementById('start').getBoundingClientRect().toJSON(),
}))();
