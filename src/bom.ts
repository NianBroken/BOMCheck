import type { BomColumn, BomData, BomRecord, Issue, ParsedSheet } from './model';
import JSZip from 'jszip/dist/jszip.min.js';
import * as XLSX from 'xlsx';
import { exportInfo } from '../export-info.mjs';
import { messages } from './messages';
import { hasVisible, referenceKey, scalarText, splitReferences } from './rules';

/** 读取阶段保留稀疏单元格，禁止依赖第三方文件声明的工作表范围。 */
export async function loadWorkbook(bytes: ArrayBuffer | Uint8Array, filename: string, encoding = 'auto'): Promise<ParsedSheet[]> {
	// 宿主文件返回的二进制对象来自另一窗口，字节视图由当前窗口构造以满足库的类型检查。
	const signature = new Uint8Array(bytes);
	bytes = signature;
	if (signature[0] === 0x50 && signature[1] === 0x4B) {
		// ZIP中央目录校验后重新生成本地头，兼容采用流式描述符的第三方BOM导出器。
		const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
		bytes = await archive.generateAsync({ type: 'uint8array', compression: 'STORE', streamFiles: false });
	}
	return readWorkbook(bytes, filename, encoding);
}

/** 文本采用用户选择的编码严格解码，工作簿忽略错误的自报范围并读取实际单元格。 */
export function readWorkbook(bytes: ArrayBuffer | Uint8Array, filename: string, encoding = 'auto'): ParsedSheet[] {
	let workbook: XLSX.WorkBook;
	if (/\.(?:csv|tsv)$/i.test(filename)) {
		const signature = bytes instanceof Uint8Array
			? bytes
			: new Uint8Array(bytes);
		// 自动模式识别编码标记，没有标记时严格使用UTF-8，旧式编码由用户明确选择。
		const detected = encoding !== 'auto'
			? encoding
			: signature[0] === 0xFF && signature[1] === 0xFE
				? 'utf-16le'
				: signature[0] === 0xFE && signature[1] === 0xFF
					? 'utf-16be'
					: 'utf-8';
		const text = new TextDecoder(detected, { fatal: true }).decode(bytes);
		workbook = XLSX.read(text, {
			type: 'string',
			raw: true,
			FS: /\.tsv$/i.test(filename)
				? '\t'
				: undefined,
		});
	}
	else {
		workbook = XLSX.read(bytes, {
			type: 'array',
			cellText: true,
			cellDates: false,
			nodim: true,
		});
	}
	if (!workbook.SheetNames.length)
		throw new Error(messages.noSheets);
	return workbook.SheetNames.map(name => parseSheet(name, workbook.Sheets[name]));
}

/** 原始单元格先保留证据，再展开合并区域，表头候选扫描整个实际数据集合。 */
function parseSheet(name: string, sheet: XLSX.WorkSheet): ParsedSheet {
	const rows = new Map<number, Map<number, string>>();
	const issues: Issue[] = [];
	const conflictRows = new Set<number>();
	let maxColumn = 0;
	const put = (r: number, c: number, value: string): void => {
		if (!rows.has(r))
			rows.set(r, new Map());
		rows.get(r)!.set(c, value);
		maxColumn = Math.max(maxColumn, c);
	};
	for (const address of Object.keys(sheet)) {
		if (address.startsWith('!') || !/^[A-Z]+\d+$/i.test(address))
			continue;
		const cell = sheet[address] as XLSX.CellObject;
		const position = XLSX.utils.decode_cell(address);
		const text = cell.t === 'e'
			? ''
			: scalarText(cell.w ?? cell.v);
		put(position.r, position.c, text);
		if (cell.t === 'e' || (cell.f && cell.v === undefined)) {
			conflictRows.add(position.r);
			issues.push({
				stage: '解析',
				row: position.r + 1,
				field: address,
				message: messages.cellError,
			});
		}
	}
	const originalRows = new Map([...rows].map(([row, cells]) => [
		row,
		new Map(cells),
	]));
	for (const merge of sheet['!merges'] ?? []) {
		const value = rows.get(merge.s.r)?.get(merge.s.c) ?? '';
		const area = (merge.e.r - merge.s.r + 1) * (merge.e.c - merge.s.c + 1);
		if (area > 1000000)
			throw new Error(messages.mergeTooLarge);
		for (let r = merge.s.r; r <= merge.e.r; r++) {
			for (let c = merge.s.c; c <= merge.e.c; c++) {
				const original = rows.get(r)?.get(c);
				if (original && original !== value) {
					for (let affected = merge.s.r; affected <= merge.e.r; affected++)
						conflictRows.add(affected);
					issues.push({
						stage: '解析',
						row: r + 1,
						field: XLSX.utils.encode_cell({ r, c }),
						message: messages.mergeConflict,
						detail: original,
					});
				}
				put(r, c, value);
			}
		}
	}
	const nonempty = [...rows].filter(([, cells]) => [
		...cells.values(),
	].some(value => value.trim()));
	const exact = nonempty.filter(([, cells]) => [
		...cells.values(),
	].some(value => value.trim() === '位号'));
	// 精确表头优先，其余候选按不同文本数量排列，总标题不会因横向合并而得高分。
	const ranked = [...nonempty].sort((a, b) => new Set([
		...b[1].values(),
	].filter(Boolean)).size - new Set([
		...a[1].values(),
	].filter(Boolean)).size);
	const candidates = [
		...new Set([
			...exact.map(([r]) => r),
			...ranked.map(([r]) => r),
		]),
	];
	return {
		name,
		rows,
		originalRows,
		maxColumn,
		candidates,
		issues,
		conflictRows,
	};
}

/** 表头按位置编码，重名和空表头不会覆盖其他数据列。 */
export function sheetColumns(sheet: ParsedSheet, headerRow: number): BomColumn[] {
	return Array.from({ length: sheet.maxColumn + 1 }, (_, index) => {
		const header = sheet.rows.get(headerRow)?.get(index)?.trim() ?? '';
		const letter = XLSX.utils.encode_col(index);
		return {
			id: `col:${index}`,
			index,
			header,
			label: `${letter} · ${header || '无表头'}`,
		};
	});
}

/** 一个来源行按位号展开为独立记录，空位号与冲突保留为集中问题，禁止猜测匹配对象。 */
export function buildBom(sheet: ParsedSheet, filename: string, headerRow: number, referenceColumn: number, separators: string[], ignoreCase: boolean, allowEmpty = false): BomData {
	if (!sheet.rows.has(headerRow))
		throw new Error(messages.emptyHeader);
	const columns = sheetColumns(sheet, headerRow);
	if (!columns[referenceColumn])
		throw new Error(messages.chooseReference);
	const records: BomRecord[] = [];
	const issues = [...sheet.issues];
	for (const [row, cells] of [...sheet.rows].sort((a, b) => a[0] - b[0])) {
		if (row <= headerRow || ![
			...cells.values(),
		].some(value => hasVisible(value))) {
			continue;
		}
		const referenceText = cells.get(referenceColumn) ?? '';
		if (referenceText.trim() === '位号' && columns[referenceColumn].header === '位号') {
			issues.push({ stage: '清洗', row: row + 1, message: messages.repeatedHeader });
			continue;
		}
		const references = splitReferences(referenceText, separators).filter(hasVisible);
		// 冲突合并区域中的原始位号保留存在性证据，禁止因展开覆盖而误判为工程多余。
		if (sheet.conflictRows.has(row)) {
			const originalReference = sheet.originalRows.get(row)?.get(referenceColumn) ?? '';
			for (const reference of splitReferences(originalReference, separators)) {
				if (!references.includes(reference))
					references.push(reference);
			}
		}
		if (!references.length) {
			issues.push({ stage: '清洗', row: row + 1, message: messages.emptyReference });
			continue;
		}
		const values = Object.fromEntries(columns.map(column => [column.id, cells.get(column.index) ?? '']));
		const originalValues = Object.fromEntries(columns.map(column => [column.id, sheet.originalRows.get(row)?.get(column.index) ?? '']));
		for (const designator of references) {
			records.push({
				designator,
				key: referenceKey(designator, ignoreCase),
				row: row + 1,
				values,
				originalValues,
				valid: !sheet.conflictRows.has(row),
			});
		}
	}
	if (!records.length && !allowEmpty)
		throw new Error(messages.noRecords);
	return {
		file: filename,
		sheet: sheet.name,
		columns,
		records,
		issues,
		ignoreCase,
	};
}

/** 导出接收有效差异行；空表只有明确状态，不生成业务表头和筛选区域。 */
export function exportTables(first: Record<string, unknown>[], second: Record<string, unknown>[]): Uint8Array {
	const workbook = XLSX.utils.book_new();
	workbook.Props = {
		Author: exportInfo.author,
		LastAuthor: exportInfo.author,
		Company: exportInfo.company,
		Keywords: exportInfo.keywords,
		Comments: exportInfo.comments,
	};
	workbook.Custprops = { Copyright: exportInfo.copyright, Website: exportInfo.website, Link: exportInfo.link };
	for (const [name, input] of [
		['工程有_BOM无', first],
		['BOM有_工程无', second],
	] as const) {
		const records = input.filter(record => hasVisible(scalarText(record.位号))
			&& !(scalarText(record.位号).trim() === '位号' && Object.entries(record).every(([key, value]) => !hasVisible(scalarText(value)) || scalarText(value) === key)));
		if (!records.length) {
			const empty = XLSX.utils.aoa_to_sheet([
				[messages.emptySheet],
			]);
			empty['!cols'] = [
				{ wch: 40 },
			];
			XLSX.utils.book_append_sheet(workbook, empty, name);
			continue;
		}
		const headers = [
			...new Set([
				'位号',
				...records.flatMap(record => Object.keys(record)),
			]),
		];
		const sheet = XLSX.utils.aoa_to_sheet([
			headers,
			...records.map(record => headers.map(header => scalarText(record[header]))),
		]);
		sheet['!autofilter'] = { ref: sheet['!ref']! };
		sheet['!cols'] = headers.map(header => ({
			wch: Math.min(55, Math.max(16, header.length * 2)),
		}));
		XLSX.utils.book_append_sheet(workbook, sheet, name);
	}
	return XLSX.write(workbook, { type: 'array', bookType: 'xlsx', compression: true }) as Uint8Array;
}
