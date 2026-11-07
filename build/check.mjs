/**
 * 命令行检查入口，先核对集中元数据，再直接调用锁定依赖中的检查程序。
 * 不通过系统同名命令定位 TypeScript 或 ESLint，避免 PATH 差异改变使用的工具版本。
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { synchronizeMetadata } from './metadata.mjs';

/**
 * 按任务名定义软件包、二进制入口键和固定检查参数。
 * typecheck 只运行 TypeScript 的无输出检查；lint 检查三个代码目录并把允许告警数设为零。
 * 两个工具均从锁定依赖定位，不从系统 PATH 选择可执行文件。
 */
const tools = {
	typecheck: {
		name: 'typescript',
		bin: 'tsc',
		args: ['--noEmit'],
	},
	lint: {
		name: 'eslint',
		bin: 'eslint',
		args: [
			'src',
			'tests',
			'build',
			'--max-warnings',
			'0',
		],
	},
};
/**
 * 检查模式只核对元数据不改写文件，未知任务名直接拒绝。
 * 从已解析的软件包清单找到实际入口，用当前 Node 执行并继承终端，退出状态传给外层命令。
 * 命令行中位于任务名之后的参数原样追加到对应检查器参数末尾。
 */
async function main() {
	await synchronizeMetadata(true);
	const selected = tools[process.argv[2]];
	if (!selected)
		throw new Error('请选择typecheck或lint检查');
	const manifestPath = fileURLToPath(import.meta.resolve(`${selected.name}/package.json`));
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	// 使用软件包清单声明的二进制映射定位入口，避免假设 npm 的命令包装器名称或格式。
	const entry = path.resolve(path.dirname(manifestPath), manifest.bin[selected.bin]);
	/**
	 * 追加调用者传入参数，标准输入输出直接连接终端，不截断或隐藏检查错误。
	 * 进程无法启动时抛出启动错误，否则保留工具的实际退出码。
	 */
	const result = spawnSync(process.execPath, [
		entry,
		...selected.args,
		...process.argv.slice(3),
	], { stdio: 'inherit' });
	if (result.error)
		throw result.error;
	process.exitCode = result.status ?? 1;
}
void main();
