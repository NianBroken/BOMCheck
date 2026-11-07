import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { validateManifest } from '../build/manifest.mjs';
import { extensionInfo } from '../build/metadata.mjs';
import { runtimeFiles } from '../build/package-files.mjs';
import { packageExtension } from '../build/utils.ts';

/** 无效清单明确拒绝，打包失败不保留临时文件或截断既有产物。 */
export async function checkManifestAndPackaging() {
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
	const root = await fs.mkdtemp(path.join(os.tmpdir(), 'bomcheck-package-'));
	try {
		const output = path.join(root, 'check.eext');
		await fs.writeFile(output, '既有完整产物', 'utf8');
		await assert.rejects(() => packageExtension(root, output));
		assert.equal(await fs.readFile(output, 'utf8'), '既有完整产物');
		for (const name of runtimeFiles) {
			await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
			await fs.writeFile(path.join(root, name), name, 'utf8');
		}
		await assert.rejects(() => packageExtension(root, path.join(root, 'missing/output.eext')));
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
