/**
 * 插件菜单公开入口，负责打开内嵌工作窗口或展示集中维护的插件信息。
 * 文件解析、工程读取与修改流程均由内嵌页面加载后执行，入口不保存业务数据。
 */
import commands from '../ui/commands.json';
import { messages } from './messages';
import { extensionInfo } from './metadata';
import { WINDOW_ID } from './rules';

/**
 * 读取可用视口，按宿主窗口接口打开固定标识的内嵌页面。
 * 视口接口缺失时传入未定义尺寸，由宿主采用默认窗口尺寸。
 * 打开失败通过宿主信息框报告，不另外构造浏览器窗口或本地文件路径。
 */
export async function openBomCheck(): Promise<void> {
	// 视口接口存在时按实际大小布置，其他宿主使用官方窗口接口的默认尺寸。
	const viewport = typeof eda.sys_Window.getViewportSize === 'function'
		? eda.sys_Window.getViewportSize()
		: undefined;
	/**
	 * 按视口宽度扣除预留空间，再限制到 640 至 1280 的窗口宽度。
	 * 该下限是传给宿主的请求值，不代表小于下限的屏幕本身能够容纳全部请求尺寸。
	 */
	const width = viewport
		? Math.min(1280, Math.max(640, viewport.width - 60))
		: undefined;
	/**
	 * 高度同样扣除预留空间并限制到 480 至 860；宿主仍负责实际窗口布局。
	 */
	const height = viewport
		? Math.min(860, Math.max(480, viewport.height - 100))
		: undefined;
	if (!await eda.sys_IFrame.openIFrame('/iframe/index.html', width, height, WINDOW_ID, { title: extensionInfo.displayName, maximizeButton: true }))
		eda.sys_Dialog.showInformationMessage(messages.windowFailed, extensionInfo.displayName, commands.closeInfo);
}

/**
 * 从集中身份定义读取显示名、英文名、版本、作者与网站，交由宿主信息框展示。
 * 信息框按钮使用共享命令字典，菜单入口名称与关于内容没有各自维护的身份副本。
 */
export function about(): void {
	eda.sys_Dialog.showInformationMessage(`${extensionInfo.displayName}\n英文名称：${extensionInfo.englishName}\n版本：${extensionInfo.version}\n作者：${extensionInfo.author}\n网站：${extensionInfo.homepage}`, `关于${extensionInfo.displayName}`, commands.closeInfo);
}
