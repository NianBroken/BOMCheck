/**
 * 界面模板的注释标记及其替换规则集中保存在此处。
 * 模板、构建器和归档校验使用同一组中文标记，业务标识仍对应页面及提示字典中的键。
 * 所有替换通过回调返回原值，文本中的美元符号不会被当成字符串替换指令。
 */
const markers = Object.freeze({
	title: '<!-- 应用标题 -->',
	navigation: '<!-- 页面导航 -->',
	css: '/* 应用样式 */',
	script: '/* 应用脚本 */',
});
/** 页面正文标记只接受英文字母键，具体键值必须能在对应数据字典中查到。 */
const contentPattern = /<!-- (页面标题|页面说明|操作文字|状态提示):([A-Za-z]+) -->/gu;
/** 此模式只检测构建专用标记，普通 HTML 注释和用户可见文本不触发未完成标记错误。 */
const unresolvedPattern = /<!-- (?:应用标题|页面导航|页面标题:|页面说明:|操作文字:|状态提示:)|\/\* 应用(?:样式|脚本) \*\//u;

/** 检查任一模板专用标记是否仍在页面中；普通说明注释不属于待替换内容。 */
export function hasTemplateMarkers(html) {
	return unresolvedPattern.test(html);
}

/**
 * 将标题、导航、字典文字和完整资源写入内嵌页面，并拒绝无法解析的内容标记。
 * 页面标题及操作文字必须为四个汉字，页面说明和状态提示沿用各自字典中的文本。
 * 脚本中的结束标签转义为 JavaScript 等价写法，防止浏览器提前结束当前脚本元素。
 */
export function renderTemplate(template, { title, navigation, pages, commands, messages, css, script }) {
	// 标题与导航先按固定标记替换，其余正文标记再依据类型从相应数据集合取值。
	const html = template.replace(markers.title, () => title).replace(markers.navigation, () => navigation).replace(contentPattern, (_match, kind, id) => {
		if (kind === '页面标题' || kind === '页面说明') {
			const page = pages.find(page => page.id === id);
			if (!page || !/^\p{Script=Han}{4}$/u.test(page.title))
				throw new Error(`页面定义无效：${id}`);
			return kind === '页面标题'
				? page.title
				: page.note;
		}
		if (kind === '操作文字') {
			const label = commands[id];
			if (!label || !/^\p{Script=Han}{4}$/u.test(label))
				throw new Error(`按钮定义无效：${id}`);
			return label;
		}
		if (!messages[id])
			throw new Error(`提示定义无效：${id}`);
		return messages[id];
	}).replace(markers.css, () => css.replace(/\/\*![\s\S]*?\*\//gu, '')).replace(markers.script, () => script.replaceAll('</script', '<\\/script'));
	// 检查最终 HTML 而非单个替换结果，任何遗漏标记都会阻止界面文件进入安装包。
	if (hasTemplateMarkers(html))
		throw new Error('页面模板存在未完成替换的标记');
	return html;
}
