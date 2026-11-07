import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import semver from 'semver';
import { extensionInfo, extensionManifest, synchronizeMetadata } from '../build/metadata.mjs';
import { exportInfo, jsonExportInfo, operationLog } from '../export-info.mjs';

/** 元数据与业务数据分别核对，Excel实现以明确保存的交付基准约束。 */
export async function checkPluginInfo() {
	await synchronizeMetadata(true);
	assert.deepEqual(Object.keys(jsonExportInfo).sort(), ['author', 'version', 'website']);
	assert.deepEqual(jsonExportInfo, { author: 'NianBroken', website: 'https://www.klaio.top/', version: '1.0.0' });
	const recovery = {
		company: '器件单位',
		keywords: '原始业务关键词',
		copyright: '原始属性',
		metadata: { link: '器件资料地址' },
	};
	const operation = [
		{ 结果: '成功', 原值: '公司字段原值', 目标值: '保留业务数据' },
	];
	for (const [original, records] of [
		[undefined, []],
		[recovery, operation],
	]) {
		const output = JSON.parse(JSON.stringify(operationLog(original, records)));
		assert.deepEqual(output.metadata, jsonExportInfo);
		assert.deepEqual(output.recovery, original ?? null);
		assert.deepEqual(Object.keys(output).sort(), ['metadata', 'operation', 'recovery']);
		assert.deepEqual(output.operation, records);
	}
	assert.equal(operationLog(recovery, operation).recovery, recovery);
	assert.equal(operationLog(recovery, operation).operation, operation);
	const manifest = extensionManifest();
	assert.equal(manifest.name, 'bomcheck');
	assert.equal(extensionInfo.englishName, 'BOMCheck');
	assert.equal(manifest.displayName, '物料核对');
	assert.equal(manifest.version, '1.0.0');
	assert.equal(manifest.engines.eda, '>=3.2.0');
	assert.equal(manifest.englishName, undefined);
	assert.deepEqual(manifest.categories, ['Schematic', 'PCB', 'Project']);
	assert.deepEqual(manifest.keywords, [
		'BOMCheck',
		'BOM',
		'物料清单',
		'器件核对',
		'属性填充',
		'差异检查',
	]);
	// 使用直接声明的SemVer工具，核对无上限范围在正式版本中的实际匹配结果。
	for (const version of [
		'3.2.0',
		'3.2.149',
		'4.1.93',
		'5.0.0',
		'10.0.0',
		'100.0.0',
	])
		assert.equal(semver.satisfies(version, manifest.engines.eda), true, version);
	for (const version of ['0.0.0', '3.1.99', '3.2.0-beta.1'])
		assert.equal(semver.satisfies(version, manifest.engines.eda), false, version);
	assert.deepEqual(exportInfo, {
		author: 'NianBroken',
		company: 'NianBroken',
		keywords: 'NianBroken',
		copyright: 'NianBroken',
		website: 'https://www.klaio.top/',
		link: 'https://www.klaio.top/',
		comments: 'https://www.klaio.top/',
		version: '1.0.0',
	});
	const baseline = JSON.parse(await fs.readFile('tests/fixtures/excel-export-baseline.json', 'utf8'));
	assert.equal(createHash('sha256').update(await fs.readFile('src/bom.ts')).digest('hex'), baseline.sourceSha256);
	console.log('JSON三字段、业务记录保持、插件信息、版本范围和Excel实现基准检查通过');
}
