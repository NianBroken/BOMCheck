import commands from '../ui/commands.json';
import { messages } from './messages';
import { extensionInfo } from './metadata';
import { WINDOW_ID } from './rules';

/** 菜单入口只负责启动窗口，数据处理由窗口中的模块化服务完成。 */
export async function openBomCheck(): Promise<void> {
	// 视口接口存在时按实际大小布置，其他宿主使用官方窗口接口的默认尺寸。
	const viewport = typeof eda.sys_Window.getViewportSize === 'function'
		? eda.sys_Window.getViewportSize()
		: undefined;
	const width = viewport
		? Math.min(1280, Math.max(640, viewport.width - 60))
		: undefined;
	const height = viewport
		? Math.min(860, Math.max(480, viewport.height - 100))
		: undefined;
	if (!await eda.sys_IFrame.openIFrame('/iframe/index.html', width, height, WINDOW_ID, { title: extensionInfo.displayName, maximizeButton: true }))
		eda.sys_Dialog.showInformationMessage(messages.windowFailed, extensionInfo.displayName, commands.closeInfo);
}

export function about(): void {
	eda.sys_Dialog.showInformationMessage(`${extensionInfo.displayName}\n英文名称：${extensionInfo.englishName}\n版本：${extensionInfo.version}\n作者：${extensionInfo.author}\n网站：${extensionInfo.homepage}`, `关于${extensionInfo.displayName}`, commands.closeInfo);
}
