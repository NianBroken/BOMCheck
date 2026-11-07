/**
 * 只读采集当前真实页面和可见面板的尺寸，供布局验收对比预期视口。
 * 矩形使用浏览器实际结果，scrollWidth 与 clientWidth 分开保留以识别横向溢出。
 */
/** 记录实际内容尺寸、面板溢出和主要操作位置。 */
(() => ({
	/**
	 * 内嵌窗口实际内宽高，必须与测试设置的窗口尺寸一致。
	 */
	size: [innerWidth, innerHeight],
	pageOverflow: document.documentElement.scrollWidth > innerWidth,
	/**
	 * 只统计未隐藏面板，保留可视区与滚动范围，不把隐藏面板零尺寸误判为布局通过。
	 */
	visible: [
		...document.querySelectorAll('[role=tabpanel]'),
	].filter(e => !e.hidden).map(e => ({
		id: e.id,
		width: e.clientWidth,
		scrollWidth: e.scrollWidth,
		height: e.clientHeight,
		scrollHeight: e.scrollHeight,
	})),
	/**
	 * 所有标签的实际边界供调用方确认入口没有超出可用窗口。
	 */
	tabs: [
		...document.querySelectorAll('[role=tab]'),
	].map(e => ({
		text: e.textContent,
		rect: e.getBoundingClientRect().toJSON(),
	})),
	/**
	 * 核对按钮位置用于判断文件页主要动作是否仍在当前视口内。
	 */
	start: document.getElementById('start').getBoundingClientRect().toJSON(),
}))();
