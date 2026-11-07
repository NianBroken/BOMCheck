/**
 * 验证完整预览、有序多来源合并、目标隔离和双工作表导出。
 * 通过真实工作簿读写与业务计划函数核对结果，不调用实际工程修改接口。
 */
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

/**
 * 构造不同来源与分隔草稿组合，再检查预览数量、字段变化、非法字符和导出属性。
 */
export function runMergeUnit(): void {
	/**
	 * 每次通过生成并回读 Excel 建立来源，允许空记录用于预览和空数据测试。
	 */
	const makeBom = (rows: string[][]) => {
		const book = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([
			['位号', '代号', '描述'],
			...rows,
		]), '数据');
		return buildBom(readWorkbook(XLSX.write(book, { type: 'array', bookType: 'xlsx' }), '清单.xlsx')[0], '清单.xlsx', 0, 0, [',', '，', '、'], true, true);
	};
	/**
	 * 单个 R1 快照保留已有描述，供覆盖计划和原值比较使用。
	 */
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
	/**
	 * 两条有序来源合并到描述字段，默认直接拼接；各场景通过副本改变顺序和分隔符。
	 */
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
	/**
	 * 七十行各拆成一个电阻和一个电容，再加入空位号和重复表头行。
	 * 预览应完整展示一百四十个有效记录，而两类异常分别进入问题集合。
	 */
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
	/**
	 * 同一位号同时配置非法多来源分隔与有效单列字段，验证错误只隔离对应目标。
	 */
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
	/**
	 * 多来源草稿含换行时，切成单来源仍可预演；实际分隔符必须为空文本。
	 */
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
	/**
	 * 可见 Unicode 字符和空串均允许，后续集合覆盖空白、零宽字符及非法代理项。
	 */
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
	/**
	 * 空位号、表头式位号及不可见位号均不生成业务列，两个空表只保存状态单元格。
	 */
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
	/**
	 * 等号开头的名称和描述以文本回读，不能被导出流程变成公式。
	 */
	const mixed = XLSX.read(exportTables([], [
		{ 位号: '=R1', 代号: '001', 描述: '=SUM(1)' },
	]), { type: 'array' });
	assert.deepEqual(XLSX.utils.sheet_to_json(mixed.Sheets[mixed.SheetNames[1]]), [
		{ 位号: '=R1', 代号: '001', 描述: '=SUM(1)' },
	]);
	assert.equal(mixed.Sheets[mixed.SheetNames[1]].C2.f, undefined);
	/**
	 * 页面数量、命令唯一性以及四字汉字标签共同约束界面字典。
	 */
	assert.equal(pages.length, 7);
	assert.equal(new Set(Object.values(commands)).size, Object.values(commands).length);
	for (const label of [
		...Object.values(commands),
		...pages.map(page => page.title),
	]) assert.match(label, /^\p{Script=Han}{4}$/u);
	console.log('全量预览、多列合并、冲突隔离、不可见字符、空表及导出身份检查通过');
}
