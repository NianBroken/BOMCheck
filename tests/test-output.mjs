/**
 * 为真实界面联调建立独立系统临时目录，统一管理截图和中间脚本。
 * 调用结束即清理目录，需要长期保存的验收证据由调用者显式复制到交付报告。
 * 目录名由系统临时目录生成器分配，测试之间不会共享同一个当前文件或截图文件名。
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/**
 * 先创建输出根及 screenshots 子目录，再等待联调动作完整结束。
 * finally 递归清理当前运行目录，动作异常继续向上传播，不把清理视为测试通过。
 * action 接收的路径已经是当前测试专属目录，调用方可以把 JSON、脚本和截图写入其中；清理发生在 action 返回或抛错之后。
 */
export async function withTestOutput(action) {
	const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'bomcheck-ui-'));
	try {
		await fs.mkdir(path.join(directory, 'screenshots'));
		await action(directory);
	}
	finally {
		await fs.rm(directory, { recursive: true, force: true });
	}
}
