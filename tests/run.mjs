/**
 * 独立测试总入口，先执行身份和归档检查，再编译并运行 TypeScript 业务测试。
 * 可额外传入真实参考目录，对三份 BOM 和工程归档做固定数量基准核对。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { pathToFileURL } from 'node:url';
import * as esbuild from 'esbuild';
import * as XLSX from 'xlsx';
import { synchronizeMetadata } from '../build/metadata.mjs';
import { checkPluginInfo } from './info-check.mjs';
import { checkManifestAndPackaging } from './manifest.mjs';

/**
 * 临时构建只写入调用方建立的测试目录，业务依赖直接复用锁定安装。
 * 无参考目录时完成独立单元测试后返回，不宣称外部真实样例已经验收。
 */
async function run(temporary) {
	await synchronizeMetadata(true);
	await checkPluginInfo();
	await checkManifestAndPackaging();
	/** 测试覆盖数据丢失、错误对应和批量确认次数，临时构建只写入测试产物目录。 */
	await esbuild.build({
		entryPoints: ['tests/unit.ts'],
		outfile: path.join(temporary, 'unit.mjs'),
		bundle: true,
		platform: 'node',
		format: 'esm',
		packages: 'external',
	});
	const { runUnit } = await import(pathToFileURL(path.resolve(path.join(temporary, 'unit.mjs'))).href);
	await runUnit();
	/**
	 * 将解析和比较入口编译到内存再保存为临时模块，动态导入以调用与正式界面相同的业务实现。
	 */
	const output = await esbuild.build({
		entryPoints: ['tests/live-entry.ts'],
		write: false,
		bundle: true,
		platform: 'node',
		format: 'esm',
		packages: 'external',
	});
	await fs.writeFile(path.join(temporary, 'core.mjs'), output.outputFiles[0].text, 'utf8');
	const { loadWorkbook, buildBom, compare, exportTables } = await import(pathToFileURL(path.resolve(path.join(temporary, 'core.mjs'))).href);

	if (!process.argv[2]) {
		console.log('独立单元测试通过；参考文件基准请显式传入目录');
		return;
	}
	/** 参考目录来自命令参数，不把特定用户路径写入项目。 */
	const referenceDir = process.argv[2];
	const files = [];
	/**
	 * 递归收集非 Office 临时文件的 xlsx，目录和文件都来自显式传入的参考路径。
	 */
	async function walk(directory) {
		for (const entry of await fs.readdir(directory, { withFileTypes: true })) {
			const full = path.join(directory, entry.name);
			if (entry.isDirectory())
				await walk(full);
			else if (entry.name.endsWith('.xlsx') && !entry.name.startsWith('~$'))
				files.push(full);
		}
	}
	await walk(referenceDir);
	const { default: JSZip } = await import('jszip');
	/**
	 * 选择参考目录内的工程归档，读取其中 epru 记录以提取 PCB 位号，不根据说明文档生成快照。
	 */
	const archivePath = (await fs.readdir(referenceDir)).find(name => name.endsWith('.epro2'));
	const zip = await JSZip.loadAsync(await fs.readFile(path.join(referenceDir, archivePath)));
	const log = await zip.file(Object.keys(zip.files).find(name => name.endsWith('.epru'))).async('string');
	const attributes = new Map();
	let docType = '';
	/**
	 * 按记录分隔符解析元信息和正文，只有 PCB 的 Designator 属性进入参考位号集合。
	 */
	for (const line of log.split('\n')) {
		const delimiter = line.indexOf('||');
		if (delimiter < 0)
			continue;
		const meta = JSON.parse(line.slice(0, delimiter));
		const data = JSON.parse(line.slice(delimiter + 2).replace(/\|\s*$/, ''));
		if (meta.type === 'DOCHEAD')
			docType = data.docType;
		if (docType === 'PCB' && meta.type === 'ATTR' && data.key === 'Designator')
			attributes.set(data.parentId, data.value);
	}
	const components = [...attributes].map(([id, designator]) => ({
		id,
		designator,
		documentId: 'reference',
		documentName: '参考PCB',
		projectId: 'reference',
		uniqueId: id,
		subPart: '',
		standard: {},
		other: {},
		metadata: {},
	}));
	assert.equal(components.length, 782);
	const reports = [];
	/**
	 * 对每份真实清单检查表头、匹配量、双向差异和空位号问题，再导出回读检查两工作表数量。
	 */
	for (const filename of files) {
		const sheets = await loadWorkbook(await fs.readFile(filename), filename);
		const sheet = sheets[0];
		assert.equal(sheet.candidates[0], 1);
		const bom = buildBom(sheet, path.basename(filename), 1, 9, [',', '，', '、'], false);
		const result = compare(bom, components);
		assert.equal(result.matchedCount, 479);
		assert.equal(result.projectOnly.length, 303);
		const is1084 = filename.includes('0001084');
		assert.equal(result.bomOnly.length, is1084 ? 2 : 1);
		assert.equal(result.bomIndex.size, is1084 ? 481 : 480);
		assert.equal(bom.issues.filter(issue => issue.message.includes('没有有效位号')).length, 32);
		const bytes = exportTables(result.projectOnly.map(component => ({ 位号: component.designator })), result.bomOnly.map(record => ({ 位号: record.designator })));
		const exported = XLSX.read(bytes, { type: 'array' });
		assert.deepEqual(exported.SheetNames, ['工程有_BOM无', 'BOM有_工程无']);
		assert.equal(XLSX.utils.sheet_to_json(exported.Sheets[exported.SheetNames[0]]).length, 303);
		reports.push({
			file: path.basename(filename),
			bom: result.bomIndex.size,
			matched: 479,
			projectOnly: 303,
			bomOnly: result.bomOnly.length,
			blankReferenceRows: 32,
		});
	}
	assert.equal(files.length, 3);
	await fs.writeFile(path.join(temporary, 'reference-results.json'), JSON.stringify(reports, null, 2), 'utf8');
	console.log('三份真实BOM基准与双工作表导出检查通过');
}

/**
 * 建立每次运行独立的 .run-* 目录，finally 清理所有临时模块和参考报告。
 */
async function main() {
	const temporary = await fs.mkdtemp(path.resolve('tests/.run-'));
	try {
		await run(temporary);
	}
	finally {
		await fs.rm(temporary, { recursive: true, force: true });
	}
}
void main();
