/**
 * 核对集中身份、日志业务数据保留、宿主版本范围及 Excel 导出实现指纹。
 * 身份断言与业务断言分开，业务对象中同名字段不会被当成身份元数据删除。
 * 该测试不写入项目文件，元数据同步使用检查模式，导出函数指纹只用于发现意外的业务实现变化。
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import semver from 'semver';
import ts from 'typescript';
import { extensionInfo, extensionManifest, synchronizeMetadata } from '../build/metadata.mjs';
import { exportInfo, jsonExportInfo, operationLog } from '../export-info.mjs';

/**
 * 先检查派生元数据一致，再检查 JSON 三字段身份和原业务对象引用。
 * 宿主范围使用已锁定 SemVer 库核对，Excel 指纹来自去除注释后的导出函数语句。
 */
export async function checkPluginInfo() {
	await synchronizeMetadata(true);
	assert.deepEqual(Object.keys(jsonExportInfo).sort(), ['author', 'version', 'website']);
	assert.deepEqual(jsonExportInfo, { author: 'NianBroken', website: 'https://www.klaio.top/', version: '1.0.0' });
	/**
	 * 故意使用 company、metadata 等与身份字段相似的业务键，验证它们作为原始数据保留。
	 */
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
	/**
	 * 检查宿主公开清单及自有英文名的边界，版本和最低宿主范围按项目契约固定。
	 */
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
	/**
	 * 指纹只约束 Excel 导出函数，注释与其他文件读取函数不进入该基准。
	 * 预期指纹取自原始实现，不用被测试的当前函数自行生成预期值。
	 */
	const baseline = JSON.parse(await fs.readFile('tests/fixtures/excel-export-baseline.json', 'utf8'));
	// 基准约束 Excel 导出函数的实际语句，注释和文件内其他读取逻辑不改变这一函数的指纹。
	const source = ts.createSourceFile('bom.ts', await fs.readFile('src/bom.ts', 'utf8'), ts.ScriptTarget.Latest, true);
	const implementation = source.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === 'exportTables');
	assert.ok(implementation, 'Excel导出实现必须存在');
	const normalized = ts.createPrinter({ removeComments: true, newLine: ts.NewLineKind.LineFeed }).printNode(ts.EmitHint.Unspecified, implementation, source);
	assert.equal(createHash('sha256').update(normalized).digest('hex'), baseline.sourceSha256);
	console.log('JSON三字段、业务记录保持、插件信息、版本范围和Excel实现基准检查通过');
}
