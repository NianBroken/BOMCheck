import type { BomData, ComponentSnapshot, Scope } from '../src/model';
import type { OperationHost } from '../src/operations';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { runInNewContext } from 'node:vm';
import * as XLSX from 'xlsx';
import { buildBom, exportTables, loadWorkbook, readWorkbook } from '../src/bom';
import { compare, planWrites } from '../src/compare';
import { messages } from '../src/messages';
import { executeDelete, executeWrites } from '../src/operations';
import { DEFAULT_IGNORE_CASE, DEFAULT_SEPARATORS, effectiveSeparators, hasVisible, splitReferences, targetFields } from '../src/rules';
import { runMergeUnit } from './merge-unit';

export async function runUnit(): Promise<void> {
	runMergeUnit();
	// 编辑界面与解析统一使用完整字面分隔符，空行与重复值不改变有效集合。
	assert.equal(DEFAULT_IGNORE_CASE, true);
	assert.deepEqual(effectiveSeparators(['', ',', ',', ' ', '||']), ['||', ' ', ',']);
	assert.deepEqual(splitReferences('C1||C2 C3', ['', '||', ' ']), ['C1', 'C2', 'C3']);
	assert.deepEqual(splitReferences('C1,C2', []), ['C1,C2']);

	const scope: Scope = {
		id: 'pcb',
		projectId: 'p',
		projectName: 'test',
		name: 'test',
		kind: 'pcb',
		documents: [
			{ id: 'd', name: 'test' },
		],
	};
	function component(designator: string, other = {}): ComponentSnapshot {
		return {
			id: designator,
			designator,
			projectId: 'p',
			documentId: 'd',
			documentName: 'test',
			uniqueId: designator,
			subPart: '',
			standard: {},
			other,
			metadata: {},
		};
	}
	function bom(rows: string[][]): BomData {
		const workbook = XLSX.utils.book_new();
		const sheet = XLSX.utils.aoa_to_sheet([
			['位号', '说明', '编号'],
			...rows,
		]);
		XLSX.utils.book_append_sheet(workbook, sheet, 'BOM');
		return buildBom(readWorkbook(XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }), 'test.xlsx')[0], 'test.xlsx', 0, 0, DEFAULT_SEPARATORS, false);
	}

	assert.deepEqual(splitReferences('DA1,DA2，DA3、DA4', DEFAULT_SEPARATORS), ['DA1', 'DA2', 'DA3', 'DA4']);
	assert.deepEqual(splitReferences('R1||R2|R3', ['||', '|']), ['R1', 'R2', 'R3']);
	assert.deepEqual(splitReferences('R1.*R2', ['.*']), ['R1', 'R2']);
	assert.deepEqual(splitReferences('R1,R2', []), ['R1,R2']);
	assert.equal(hasVisible(' \n\t\u3000\u200B\u200D\uFEFF'), false);
	assert.equal(hasVisible(0), true);
	assert.equal(hasVisible(false), true);
	/** 偏移表头、重复列名和纵向合并必须保留来源，冲突位号只参与存在性核对。 */
	const structured = XLSX.utils.book_new();
	const merged = XLSX.utils.aoa_to_sheet([
		['标题'],
		[],
		['', '', '位号', '说明', '说明'],
		['', '', 'R1', '共同值', '001'],
		['', '', 'R2', '', '002'],
	]);
	merged['!merges'] = [
		XLSX.utils.decode_range('D4:D5'),
	];
	XLSX.utils.book_append_sheet(structured, merged, '纵向');
	/** 文件选择接口返回的跨窗口缓冲区必须与同窗口字节得到一致的工作表。 */
	const workbookBytes = XLSX.write(structured, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
	for (const expression of ['Uint8Array.from(bytes).buffer', 'Uint8Array.from(bytes)']) {
		const foreign = runInNewContext(expression, {
			bytes: Array.from(new Uint8Array(workbookBytes)),
		}) as ArrayBuffer | Uint8Array;
		const parsed = await loadWorkbook(foreign, '跨窗口.xlsx');
		assert.equal(parsed[0].rows.get(2)?.get(2), '位号');
		assert.equal(parsed[0].rows.get(4)?.get(3), '共同值');
	}
	XLSX.utils.book_append_sheet(structured, XLSX.utils.aoa_to_sheet([
		['其他表'],
	]), '其他');
	for (const format of ['xlsx', 'xls'] as const) {
		const sheets = readWorkbook(XLSX.write(structured, { type: 'array', bookType: format }), `test.${format}`);
		assert.equal(sheets.length, 2);
		assert.equal(sheets[0].candidates[0], 2);
		assert.equal(sheets[0].rows.get(4)?.get(3), '共同值');
		const parsed = buildBom(sheets[0], `test.${format}`, 2, 2, DEFAULT_SEPARATORS, false);
		assert.equal(parsed.records.length, 2);
		assert.notEqual(parsed.columns[3].id, parsed.columns[4].id);
	}
	merged['!merges'] = [
		XLSX.utils.decode_range('C4:C5'),
	];
	const conflicted = buildBom(readWorkbook(XLSX.write(structured, { type: 'array', bookType: 'xlsx' }), 'conflict.xlsx')[0], 'conflict.xlsx', 2, 2, DEFAULT_SEPARATORS, false);
	assert(conflicted.records.some(record => record.designator === 'R2'));
	assert(conflicted.records.every(record => !record.valid));
	assert.equal(compare(conflicted, [
		component('R1'),
		component('R2'),
	]).projectOnly.length, 0);
	const utf8Csv = readWorkbook(new TextEncoder().encode('位号,说明\nR1,"中文,描述"'), 'test.csv')[0];
	assert.equal(buildBom(utf8Csv, 'test.csv', 0, 0, DEFAULT_SEPARATORS, false).records[0].values['col:1'], '中文,描述');
	const gbkCsv = Uint8Array.from([
		0xCE,
		0xBB,
		0xBA,
		0xC5,
		0x2C,
		0xCB,
		0xB5,
		0xC3,
		0xF7,
		0x0A,
		0x52,
		0x31,
		0x2C,
		0xD6,
		0xD0,
		0xCE,
		0xC4,
	]);
	const legacy = readWorkbook(gbkCsv, 'legacy.csv', 'gb18030')[0];
	assert.equal(buildBom(legacy, 'legacy.csv', 0, 0, DEFAULT_SEPARATORS, false).records[0].values['col:1'], '中文');
	assert.throws(() => readWorkbook(gbkCsv, 'legacy.csv', 'utf-8'));
	const tsv = readWorkbook(new TextEncoder().encode('位号\t说明\nR1\t中文'), 'test.tsv')[0];
	assert.equal(buildBom(tsv, 'test.tsv', 0, 0, DEFAULT_SEPARATORS, false).records[0].designator, 'R1');
	const utf16 = readWorkbook(new Uint8Array(Buffer.from('\uFEFF位号\t说明\nR1\t中文', 'utf16le')), 'test.tsv')[0];
	assert.equal(buildBom(utf16, 'test.tsv', 0, 0, DEFAULT_SEPARATORS, false).records[0].values['col:1'], '中文');

	const original = [
		component('R1', { Description: ' ' }),
		component('R2', { Description: '原说明', unrelated: '保留' }),
		component('R3'),
	];
	const data = bom([
		['R1,R2', '目标说明', '00123'],
		['贴麦拉片上', '文字', '00124'],
		['', '空位号', ''],
	]);
	const comparison = compare(data, original);
	assert.deepEqual(comparison.projectOnly.map(item => item.designator), ['R3']);
	assert.deepEqual(comparison.bomOnly.map(item => item.designator), ['贴麦拉片上']);
	const fields = targetFields(original);
	const mappings = [
		{
			id: 'm1',
			sources: [
				{ id: 's1', columnId: 'col:1' },
			],
			separator: '',
			fieldId: 'other:Description',
		},
		{
			id: 'm2',
			sources: [
				{ id: 's2', columnId: 'col:2' },
			],
			separator: '',
			fieldId: 'standard:supplierId',
		},
	];
	const plan = planWrites(comparison, mappings, fields, false);
	assert.equal(plan.items.length, 2);
	assert.equal(plan.overwriteCount, 1);
	assert.equal(plan.items[0].changes[1].after, '00123');

	/** 假宿主仅验证业务控制行为，真实宿主核验由独立联调执行。 */
	let confirms = 0;
	let writes = 0;
	let issuePrompts = 0;
	const current = new Map(original.map(item => [
		item.id,
		structuredClone(item),
	]));
	const host: OperationHost = {
		confirm: async () => {
			confirms++;
			return true;
		},
		assertProject: async () => {},
		save: async () => {},
		readOne: async (_scope, item) => structuredClone(current.get(item.id)!),
		write: async (_scope, item, changes) => {
			writes++;
			const result = current.get(item.id)!;
			for (const change of changes) {
				(change.field.kind === 'other'
					? result.other
					: result.standard)[change.field.key] = change.after;
			}
			return structuredClone(result);
		},
		remove: async (_scope, item) => {
			current.delete(item.id);
		},
	};
	const report = await executeWrites(host, scope, plan, async () => {
		issuePrompts++;
	}, () => {});
	assert.equal(confirms, 1);
	assert.equal(writes, 2);
	await assert.rejects(() => executeDelete(host, scope, {
		...comparison,
		bom: {
			...comparison.bom,
			issues: [
				{ stage: '解析', message: '合并冲突' },
			],
		},
	}, () => {}), /禁止删除/);
	assert.equal(issuePrompts, 1);
	assert.equal(report.filter(row => row.结果 === '成功').length, 4);
	assert.equal(current.get('R2')!.other.unrelated, '保留');

	const canceled = await executeWrites({
		...host,
		confirm: async () => false,
	}, scope, plan, async () => {}, () => {});
	assert.equal(canceled[0].结果, '已取消');
	assert.equal(writes, 2);

	const duplicates = planWrites(compare(bom([
		['R1', '甲', '123'],
		['R1', '乙', '123'],
	]), [
		component('R1'),
	]), mappings, fields, false);
	assert.equal(duplicates.items[0].changes.length, 1);
	assert.equal(duplicates.items[0].changes[0].field.key, 'supplierId');
	assert(duplicates.issues.some(issue => issue.message === messages.sourceConflict));
	assert.equal(planWrites(compare(bom([
		['R1', '', ''],
	]), [
		component('R1', { Description: '内容' }),
	]), [mappings[0]], fields, false).items.length, 0);
	assert.equal(planWrites(compare(bom([
		['R1', '', ''],
	]), [
		component('R1', { Description: '内容' }),
	]), [mappings[0]], fields, true).overwriteCount, 1);
	assert.equal(compare(bom([
		['r1', '', ''],
	]), [
		component('R1'),
	]).matchedCount, 0);
	const insensitive = bom([
		['r1', '', ''],
	]);
	insensitive.ignoreCase = true;
	insensitive.records[0].key = 'R1';
	assert.equal(compare(insensitive, [
		component('R1'),
	]).matchedCount, 1);

	const failedFirst = await executeWrites({
		...host,
		readOne: async (_scope, item) => {
			if (item.id === 'R1')
				throw new Error('局部失败');
			return component('R2', { Description: '原说明' });
		},
	}, scope, plan, async () => {}, () => {});
	assert(failedFirst.some(row => row.结果 === '失败'));
	assert(failedFirst.some(row => row.结果 === '成功'));

	const duplicateEngineering = compare(bom([
		['R1', '', ''],
	]), [
		component('R2'),
		{
			...component('R2'),
			id: 'different',
			uniqueId: 'different',
		},
	]);
	await assert.rejects(() => executeDelete(host, scope, duplicateEngineering, () => {}), { message: messages.noDelete });
	const deleteCanceled = await executeDelete({
		...host,
		confirm: async () => false,
	}, scope, comparison, () => {});
	assert.equal(deleteCanceled[0].结果, '已取消');
	assert(current.has('R3'));
	await executeDelete(host, scope, comparison, () => {});
	assert(!current.has('R3'));
	/** 数组删除只对未生效的目标逐颗处理，已经删除的图元不会重复提交。 */
	for (const ref of ['R4', 'R5', 'R6'])
		current.set(ref, component(ref));
	const bulkComparison = compare(data, ['R4', 'R5', 'R6'].map(ref => component(ref)));
	let bulkCalls = 0;
	const fallbackCalls: string[] = [];
	const bulkRows = await executeDelete({
		...host,
		removeMany: async () => {
			bulkCalls++;
			current.delete('R4');
			return {
				removed: ['R4'],
				error: '局部未删除',
			};
		},
		remove: async (_scope, item) => {
			fallbackCalls.push(item.id);
			if (item.id === 'R5')
				throw new Error('单颗删除失败');
			current.delete(item.id);
		},
	}, scope, bulkComparison, () => {});
	assert.equal(bulkCalls, 1);
	assert.deepEqual(fallbackCalls, ['R5', 'R6']);
	assert.equal(bulkRows.filter(row => row.结果 === '删除成功').length, 2);
	assert.equal(bulkRows.filter(row => row.结果 === '删除失败').length, 1);

	const exported = XLSX.read(exportTables([
		{ 位号: '=R1', 编号: '00123' },
	], []), { type: 'array' });
	assert.equal(exported.Sheets['工程有_BOM无'].A2.t, 's');
	assert.equal(exported.Sheets['工程有_BOM无'].A2.f, undefined);
	assert.equal(exported.Sheets['工程有_BOM无'].B2.v, '00123');
	assert(exported.Sheets['BOM有_工程无']);
	console.log('核心解析、匹配、覆盖确认、空值、冲突、错误隔离与删除控制检查通过');
}
