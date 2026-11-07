/**
 * 对发布清单、中文模板和归档写入失败路径执行隔离检查。
 * 所有文件场景使用系统临时目录，不覆盖项目正式安装包。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { validateManifest } from '../build/manifest.mjs';
import { extensionInfo } from '../build/metadata.mjs';
import { runtimeFiles } from '../build/package-files.mjs';
import { hasTemplateMarkers, renderTemplate } from '../build/template.mjs';
import { packageExtension } from '../build/utils.ts';

/**
 * 先验证模板替换和失败分支，再遍历清单缺项及非法仓库输入。
 * 归档场景检查源文件缺失、目标父目录缺失、目标为目录及完整生成后的逐项回读。
 */
export async function checkManifestAndPackaging() {
	// 中文模板标记与残留检查共用定义，普通说明注释可以保留，未匹配的业务键必须明确失败。
	const template = '<title><!-- 应用标题 --></title><!-- 页面导航 --><!-- 页面标题:file --><!-- 页面说明:file --><!-- 操作文字:choose --><!-- 状态提示:ready --><style>/* 应用样式 */</style><script>/* 应用脚本 */</script>';
	const context = {
		title: '物料核对',
		navigation: '导航',
		pages: [
			{ id: 'file', title: '导入设置', note: '页面说明' },
		],
		commands: { choose: '导入清单' },
		messages: { ready: '就绪' },
		css: 'a{}',
		script: 'const text = "</script>";',
	};
	const rendered = renderTemplate(template, context);
	assert.equal(hasTemplateMarkers(rendered), false);
	assert.ok(rendered.includes('导入设置页面说明导入清单就绪'));
	assert.ok(rendered.includes('<\\/script>'));
	assert.equal(hasTemplateMarkers('<!-- 普通页面结构说明 -->'), false);
	assert.throws(() => renderTemplate('<!-- 操作文字:missing -->', context));
	assert.throws(() => renderTemplate('<!-- 页面标题:missing -->', context));
	assert.throws(() => renderTemplate('<!-- 状态提示:missing -->', context));
	assert.throws(() => renderTemplate('/* 应用脚本 */ /* 应用脚本 */', context));
	assert.doesNotThrow(() => validateManifest(extensionInfo));
	for (const key of [
		'name',
		'uuid',
		'displayName',
		'description',
		'version',
		'license',
		'repository',
	]) {
		const missing = structuredClone(extensionInfo);
		delete missing[key];
		assert.throws(() => validateManifest(missing), key);
		for (const value of ['', ' ', null, 12, []])
			assert.throws(() => validateManifest({ ...extensionInfo, [key]: value }), key);
	}
	for (const [key, value] of [
		['name', 'Invalid Name'],
		['name', 'abc'],
		[
			'uuid',
			'0'.repeat(32),
		],
		[
			'uuid',
			'x'.repeat(32),
		],
		['version', '1.0.1'],
		['license', 'MIT'],
	]) assert.throws(() => validateManifest({ ...extensionInfo, [key]: value }));
	for (const repository of [
		{},
		{ type: 'unknown', url: extensionInfo.repository.url },
		{ type: 'github', url: '' },
		{ type: 'github', url: 'invalid' },
		{ type: 'github', url: 'https:github.com/NianBroken/BOMCheck' },
		{ type: 'github', url: 'http://github.com/NianBroken/BOMCheck' },
		{ type: 'github', url: 'https://example.com/NianBroken/BOMCheck' },
		{ type: 'github', url: 'https://github.com/NianBroken' },
		{ type: 'github', url: 'https://github.com/NianBroken/BOMCheck#readme' },
		{ type: 'git', url: 'https://user:pass@example.com/repository' },
	]) assert.throws(() => validateManifest({ ...extensionInfo, repository }));
	/**
	 * 每次使用独立临时根目录，正常完成或断言失败都会由 finally 递归清理。
	 */
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bomcheck-package-'));
	try {
		/**
		 * 预先写入完整目标文件，再制造缺少运行资源的失败，检查已有产物不会被截断。
		 */
		const output = path.join(root, 'check.eext');
		await fs.writeFile(output, '既有完整产物', 'utf8');
		await assert.rejects(() => packageExtension(root, output));
		assert.equal(await fs.readFile(output, 'utf8'), '既有完整产物');
		/**
		 * 按共享发布清单准备最小内容，文件名本身作为测试字节便于解包后逐项核对。
		 */
		for (const name of runtimeFiles) {
			await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
			await fs.writeFile(path.join(root, name), name, 'utf8');
		}
		await assert.rejects(() => packageExtension(root, path.join(root, 'missing/output.eext')));
		/**
		 * 目标已经是目录时归档提交必须失败，且不遗留以 .tmp 结尾的暂存文件。
		 */
		const directoryOutput = path.join(root, 'directory.eext');
		await fs.mkdir(directoryOutput);
		await assert.rejects(() => packageExtension(root, directoryOutput));
		assert.ok(!(await fs.readdir(root)).some(name => name.endsWith('.tmp')));
		await packageExtension(root, output);
		const zip = await JSZip.loadAsync(await fs.readFile(output), { checkCRC32: true });
		for (const name of runtimeFiles)
			assert.equal(await zip.file(name).async('string'), name);
	}
	finally {
		await fs.rm(root, { recursive: true, force: true });
	}
	console.log('清单必填项、仓库信息、归档生成与打包失败清理检查通过');
}
