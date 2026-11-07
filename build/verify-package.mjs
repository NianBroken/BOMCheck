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

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

/** 当前归档与源码逐项比对，不读取历史宿主测试证据。 */
export async function verifyPackage(bytes) {
	await synchronizeMetadata(true);
	const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
	const entries = Object.values(archive.files).filter(item => !item.dir).map(item => item.name).sort();
	assert.deepEqual(entries, [...runtimeFiles].sort());
	const manifest = JSON.parse(await archive.file('extension.json').async('string'));
	validateManifest(manifest);
	assert.deepEqual(manifest, extensionManifest());
	assert.deepEqual(JSON.parse(archive.comment), exportInfo);
	for (const filename of runtimeFiles)
		assert.deepEqual(await archive.file(filename).async('nodebuffer'), await fs.readFile(path.join(root, filename)), filename);
	const html = await archive.file('iframe/index.html').async('string');
	assert.ok(!/<script[^>]+src\s*=/iu.test(html), '页面脚本必须内联');
	assert.ok(!/<!-- (?:APP_|PAGE_|TITLE:|NOTE:|COMMAND:|MESSAGE:)/u.test(html), '页面占位符必须完成替换');
	assert.equal((html.match(/role="tab"/gu) ?? []).length, pages.length);
	assert.ok(pages.every(page => html.includes(`id="panel-${page.id}"`)));
	assert.ok(!/C:\\Users\\|C:\\ProgramData\\|127\.0\.0\.1:922[45]/u.test(html));
	const script = await archive.file('dist/index.js').async('string');
	const entry = runInNewContext(`${script}; edaEsbuildExportName;`);
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

/** 直接核验最终安装包、文件集合与SHA-256校验文件。 */
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
