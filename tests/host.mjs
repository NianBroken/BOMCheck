/**
 * 将真实宿主测试编译为浏览器脚本，通过明确指定的客户端和会话调用。
 * 测试使用临时代码文件，不把客户端路径或用户工程标识写进正式插件。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import * as esbuild from 'esbuild';

/**
 * 参数必须同时提供客户端和独立验收会话；缺失时明确报告调用用法。
 * 编译后以官方 invoke 执行，核对退出状态、JSON 成功标记及实际写入验证结果。
 */
async function main() {
	const [client, session] = process.argv.slice(2);
	assert.ok(client && session, '用法：node tests/host.mjs 客户端路径 独立验收会话');
	const temporary = await fs.mkdtemp(path.join(os.tmpdir(), 'bomcheck-host-'));
	try {
		const bundle = await esbuild.build({
			entryPoints: ['tests/host-entry.ts'],
			bundle: true,
			write: false,
			format: 'iife',
			globalName: 'BOMCheckHostTests',
			platform: 'browser',
			target: 'es2020',
		});
		const source = path.join(temporary, 'host.js');
		await fs.writeFile(source, `${bundle.outputFiles[0].text}\nreturn await BOMCheckHostTests.runHostChecks();`, 'utf8');
		/**
		 * 宿主调用最多等待指定预算，标准输出必须能够解析为结果对象；stderr 在失败时进入断言详情。
		 */
		const execution = spawnSync(client, [
			'invoke',
			'--session',
			session,
			'--code-file',
			source,
			'--timeout',
			'180000',
		], { encoding: 'utf8', timeout: 200000 });
		assert.ifError(execution.error);
		assert.equal(execution.status, 0, execution.stderr || execution.stdout);
		const result = JSON.parse(execution.stdout);
		assert.equal(result.ok, true, JSON.stringify(result));
		assert.ok(result.value.results.some(item => item.writeVerified));
		console.log(JSON.stringify(result.value, null, 2));
	}
	/**
	 * 无论宿主执行成功或测试失败，都移除当前运行临时脚本目录。
	 */
	finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
}
void main();
