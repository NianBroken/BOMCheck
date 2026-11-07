/**
 * 对实际 .eext 字节进行独立归档核验，不以构建步骤的返回信息代替当前包检查。
 * 共享运行目录和清单生成器提供预期内容，校验和针对最终压缩包的实际字节计算。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import JSZip from 'jszip';
import { exportInfo } from '../export-info.mjs';
import pages from '../ui/pages.json' with { type: 'json' };
import { validateManifest } from './manifest.mjs';
import { extensionInfo, extensionManifest, packageName, synchronizeMetadata } from './metadata.mjs';
import { runtimeFiles } from './package-files.mjs';
import { hasTemplateMarkers } from './template.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * 返回输入字节的十六进制 SHA-256，用于最终安装包和外部校验文件比对。
 */
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/**
 * 先核对当前元数据，再校验 ZIP 的 CRC32、完整文件集合和归档身份。
 * 逐运行文件比较归档内容与当前磁盘内容，检查内嵌页面、菜单函数和 PNG 签名。
 * 所有断言通过才返回安装包名称、字节数、文件数和实际校验和。
 */
export async function verifyPackage(bytes) {
	await synchronizeMetadata(true);
	// CRC32 检查逐项验证压缩内容完整性，损坏归档会在读取内部文件前失败。
	const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
	/**
	 * 排除 ZIP 目录项后对文件名排序，必须恰好等于共享清单，既不能缺文件也不能多带开发文件。
	 */
	const entries = Object.values(archive.files).filter(item => !item.dir).map(item => item.name).sort();
	assert.deepEqual(entries, [...runtimeFiles].sort());
	const manifest = JSON.parse(await archive.file('extension.json').async('string'));
	validateManifest(manifest);
	assert.deepEqual(manifest, extensionManifest());
	assert.deepEqual(JSON.parse(archive.comment), exportInfo);
	// 包内运行文件逐字节对照当前构建目录，确保待验归档对应现有磁盘内容。
	for (const filename of runtimeFiles)
		assert.deepEqual(await archive.file(filename).async('nodebuffer'), await fs.readFile(path.join(root, filename)), filename);
	/**
	 * 页面脚本必须内嵌，中文模板不得残留，每个页面定义都要有对应面板和标签。
	 * 同时拒绝已列出的本机路径及调试端口信息出现在正式页面中。
	 */
	const html = await archive.file('iframe/index.html').async('string');
	assert.ok(!/<script[^>]+src\s*=/iu.test(html), '页面脚本必须内联');
	assert.ok(!hasTemplateMarkers(html), '页面占位符必须完成替换');
	assert.equal((html.match(/role="tab"/gu) ?? []).length, pages.length);
	assert.ok(pages.every(page => html.includes(`id="panel-${page.id}"`)));
	assert.ok(!/C:\\Users\\|C:\\ProgramData\\|127\.0\.0\.1:922[45]/u.test(html));
	const script = await archive.file('dist/index.js').async('string');
	/**
	 * 在独立脚本上下文执行宿主入口定义，取得其导出对象并验证菜单注册函数。
	 * 此处不调用函数，不访问真实 eda，不用语法存在代替实际工程操作测试。
	 */
	const entry = runInNewContext(`${script}; edaEsbuildExportName;`);
	// 清单中的每个菜单回调都必须能在入口导出对象上找到可调用函数。
	assert.equal(typeof entry.openBomCheck, 'function');
	assert.equal(typeof entry.about, 'function');
	for (const menus of Object.values(manifest.headerMenus)) {
		for (const menu of menus) {
			for (const item of menu.menuItems)
				assert.equal(typeof entry[item.registerFn], 'function', item.registerFn);
		}
	}
	const png = await archive.file('images/logo.png').async('nodebuffer');
	assert.equal(png.subarray(0, 8).toString('hex'), '89504e470d0a1a0a');
	assert.equal(extensionInfo.version, '1.0.0');
	return {
		package: packageName,
		sha256: sha256(bytes),
		bytes: bytes.length,
		files: entries.length,
	};
}

/**
 * 直接运行时读取正式安装包，并核对其旁边 SHA-256 文件的完整文本。
 * 导入本模块时只提供验证函数，不自行读取安装包。
 */
async function main() {
	if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
		process.chdir(root);
		const output = path.join(root, 'build/dist', packageName);
		const result = await verifyPackage(await fs.readFile(output));
		assert.equal(await fs.readFile(`${output}.sha256`, 'utf8'), `${result.sha256}  ${packageName}\n`);
		console.log(JSON.stringify(result, null, 2));
	}
}
void main();
