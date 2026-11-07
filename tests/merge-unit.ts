import type { ComponentSnapshot, Mapping } from '../src/model';
import assert from 'node:assert/strict';
import * as XLSX from 'xlsx';
import { exportInfo } from '../export-info.mjs';
import { buildBom, exportTables, readWorkbook } from '../src/bom';
import { compare, planWrites } from '../src/compare';
import { previewRows } from '../src/display';
import { messages } from '../src/messages';
import { targetFields, validJoinSeparator } from '../src/rules';
import commands from '../ui/commands.json';
import pages from '../ui/pages.json';

/** 有效器件全量展示、多来源合并和导出文件均用回读结果核验。 */
export function runMergeUnit(): void {
	const makeBom = (rows: string[][]) => {
		const book = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
			['位号', '代号', '描述'],
			...rows,
		]), '数据');
		return buildBom(readWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), '清单.xlsx')[0], '清单.xlsx', 0, 0, [',', '，', '、'], true, true);
	};
	const component: ComponentSnapshot = {
		id: 'r1',
		designator: 'R1',
		projectId: 'p',
		documentId: 'd',
		documentName: 'PCB',
		uniqueId: 'r1',
		subPart: '',
		standard: {},
		other: { Description: '旧值' },
		metadata: {},
	};
	const fields = targetFields([component]);
	const mapping: Mapping = {
		id: 'g',
		fieldId: 'other:Description',
		separator: '',
		sources: [
			{ id: 's1', columnId: 'col:1' },
			{ id: 's2', columnId: 'col:2' },
		],
	};
	const plan = (rows: string[][], group = mapping, clear = false) => planWrites(compare(makeBom(rows), [component]), [group], fields, clear);
	const full = makeBom([
		...Array.from({ length: 70 }, (_, index) => [`R${index + 1},C${index + 1}`, `00${index}`, `值${index}`]),
		['', '无位号', ''],
		['位号', '代号', '描述'],
	]);
	const preview = previewRows(full);
	assert.equal(preview.length, 140);
	assert.equal(preview.at(-1)!.位号, 'C70');
	assert.equal(preview.at(-1)!['B · 代号'], '0069');
	assert(full.issues.some(issue => issue.message === messages.emptyReference));
	assert(full.issues.some(issue => issue.message === messages.repeatedHeader));
	const duplicate = compare(makeBom([
		['X1', '甲', '乙'],
		['X1', '丙', '丁'],
	]), []);
	assert.equal(duplicate.bomOnly.length, 2);
	assert.equal(plan([
		['R1', '001', '描述'],
	]).items[0].changes[0].after, '001描述');
	assert.equal(plan([
		['R1', '001', '描述'],
	], { ...mapping, separator: '::' }).items[0].changes[0].after, '001::描述');
	assert.equal(plan([
		['R1', '001', '描述'],
	], {
		...mapping,
		sources: [...mapping.sources].reverse(),
		separator: '|',
	}).items[0].changes[0].after, '描述|001');
	assert.equal(plan([
		['R1', '\u200B', '描述'],
	], { ...mapping, separator: '|' }).items[0].changes[0].after, '描述');
	assert.equal(plan([
		['R1', '', '\t'],
	]).items.length, 0);
	assert.equal(plan([
		['R1', '', '\t'],
	], mapping, true).items[0].changes[0].after, '');
	assert.equal(plan([
		['R1', 'ab', 'c'],
		['R1', 'a', 'bc'],
	]).items.length, 0);
	const invalid = planWrites(compare(makeBom([
		['R1', '甲', '乙'],
	]), [component]), [
		{ ...mapping, separator: ' ' },
		{
			...mapping,
			id: 'valid',
			fieldId: 'standard:supplierId',
			sources: [mapping.sources[0]],
		},
	], fields, false);
	assert.equal(invalid.items[0].changes.length, 1);
	assert(invalid.issues.some(issue => issue.message === messages.separatorInvalid));
	// 隐藏的多来源草稿不参与单来源写入，重新合并时仍按原草稿校验。
	const single = plan([
		['R1', '甲', '乙'],
	], {
		...mapping,
		sources: [mapping.sources[0]],
		separator: '\n',
	});
	assert.equal(single.items[0].changes[0].after, '甲');
	assert.equal(single.items[0].changes[0].separator, '');
	assert(!single.issues.some(issue => issue.message === messages.separatorInvalid));
	assert.equal(plan([
		['R1', '甲', '乙'],
	], { ...mapping, sources: [], separator: '\n' }).items.length, 0);
	assert.equal(plan([
		['R1', '甲', '乙'],
	], { ...mapping, separator: '\n' }).items.length, 0);
	for (const value of ['', '|', '::', '中文', '🙂', 'é', '<>=']) assert.equal(validJoinSeparator(value), true, value);
	for (const value of [
		' ',
		'\t',
		'\n',
		'\u200B',
		'\uFEFF',
		'a\u200Db',
		'\u3000',
		'\u0000',
		'\uD800',
		'\u034F',
		'\uFE0F',
	]) assert.equal(validJoinSeparator(value), false, JSON.stringify(value));
	const empty = XLSX.read(exportTables([
		{ 位号: '' },
		{ 位号: '位号' },
		{ 位号: '\u200B' },
	], []), { type: 'array' });
	assert.deepEqual(empty.SheetNames, ['工程有_BOM无', 'BOM有_工程无']);
	for (const name of empty.SheetNames) {
		assert.equal(empty.Sheets[name].A1.v, messages.emptySheet);
		assert.equal(empty.Sheets[name]['!ref'], 'A1');
		assert.equal(empty.Sheets[name]['!autofilter'], undefined);
	}
	assert.equal(empty.Props!.Author, exportInfo.author);
	assert.equal(empty.Props!.LastAuthor, exportInfo.author);
	assert.equal(empty.Props!.Company, exportInfo.company);
	assert.equal(empty.Props!.Keywords, exportInfo.keywords);
	assert.equal(empty.Props!.Comments, exportInfo.comments);
	assert.equal(empty.Custprops!.Copyright, exportInfo.copyright);
	assert.equal(empty.Custprops!.Website, exportInfo.website);
	assert.equal(empty.Custprops!.Link, exportInfo.link);
	const mixed = XLSX.read(exportTables([], [
		{ 位号: '=R1', 代号: '001', 描述: '=SUM(1)' },
	]), { type: 'array' });
	assert.deepEqual(XLSX.utils.sheet_to_json(mixed.Sheets[mixed.SheetNames[1]]), [
		{ 位号: '=R1', 代号: '001', 描述: '=SUM(1)' },
	]);
	assert.equal(mixed.Sheets[mixed.SheetNames[1]].C2.f, undefined);
	assert.equal(pages.length, 7);
	assert.equal(new Set(Object.values(commands)).size, Object.values(commands).length);
	for (const label of [
		...Object.values(commands),
		...pages.map(page => page.title),
	]) assert.match(label, /^\p{Script=Han}{4}$/u);
	console.log('全量预览、多列合并、冲突隔离、不可见字符、空表及导出身份检查通过');
}
