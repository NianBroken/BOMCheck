/**
 * 物料文件的读取、工作表展开、位号记录生成及双工作表导出。
 * 工作表使用稀疏行列映射保存实际单元格，同时保存合并展开前的证据。
 * 解析错误只形成问题记录和来源有效性标记，工程修改由独立操作服务负责。
 */
import type { BomColumn, BomData, BomRecord, Issue, ParsedSheet } from './model';
import JSZip from 'jszip/dist/jszip.min.js';
import * as XLSX from 'xlsx';
import { exportInfo } from '../export-info.mjs';
import { messages } from './messages';
import { hasVisible, referenceKey, scalarText, splitReferences } from './rules';

/**
 * 文件后缀决定是否进入文本解码流程，CSV 和 TSV 的大小写使用同一规则。
 * 字节签名检查前先判断文件类别，因此首列以 PK 开头的 CSV 或 TSV 仍按文本读取。
 */
function isTextWorkbook(filename: string): boolean {
	return /\.(?:csv|tsv)$/i.test(filename);
}

/**
 * 将文件字节转换为当前窗口的字节视图，再按文件类别执行归档预处理。
 * 文本格式直接进入解码；其他文件以 PK 字节开头时，先校验 ZIP 内各条目的 CRC32。
 * 归档按无压缩、无流式描述符的方式重建后交给工作簿库；无效归档的异常向调用方传播。
 * 返回每张工作表的稀疏数据、表头候选和问题证据，不读取或修改工程。
 */
export async function loadWorkbook(bytes: ArrayBuffer | Uint8Array, filename: string, encoding = 'auto'): Promise<ParsedSheet[]> {
	// 宿主文件返回的二进制对象来自另一窗口，字节视图由当前窗口构造以满足库的类型检查。
	/**
	 * ArrayBuffer 建立字节视图，Uint8Array 按有效元素复制；两者均得到当前窗口的类型。
	 * 这里不使用输入对象的完整底层缓冲区，因此带偏移的字节片段也只读取传入的有效范围。
	 */
	const signature = new Uint8Array(bytes);
	bytes = signature;
	if (!isTextWorkbook(filename) && signature[0] === 0x50 && signature[1] === 0x4B) {
		// ZIP中央目录校验后重新生成本地头，兼容采用流式描述符的第三方BOM导出器。
		const archive = await JSZip.loadAsync(bytes, { checkCRC32: true });
		bytes = await archive.generateAsync({ type: 'uint8array', compression: 'STORE', streamFiles: false });
	}
	return readWorkbook(bytes, filename, encoding);
}

/**
 * 同步解析规范化后的字节，并保持工作表在文件中的原始顺序。
 * CSV 和 TSV 使用严格解码，非法字节直接报错；TSV 显式使用制表符分列。
 * 二进制工作簿读取实际单元格，保留显示文字，日期不转换为 Date 对象。
 * 文件没有工作表时抛出明确错误，存在的工作表分别交给稀疏解析器处理。
 */
export function readWorkbook(bytes: ArrayBuffer | Uint8Array, filename: string, encoding = 'auto'): ParsedSheet[] {
	let workbook: XLSX.WorkBook;
	if (isTextWorkbook(filename)) {
		const signature = bytes instanceof Uint8Array
			? bytes
			: new Uint8Array(bytes);
		// 自动模式识别编码标记，没有标记时严格使用UTF-8，旧式编码由用户明确选择。
		/**
		 * 用户明确选择的编码优先。自动模式识别 UTF-16 的大小端标记，其余输入按 UTF-8 解码。
		 * TextDecoder 负责移除编码标记，fatal 模式禁止以替代字符掩盖非法字节。
		 */
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

/**
 * 将单张工作表转换为以零开始的行号和列号映射。
 * 原始映射保存展开前单元格，工作映射保存合并展开后的读取值，两者用于区分原值和继承值。
 * 错误单元格、没有缓存结果的公式和合并区域冲突会标记受影响来源行。
 */
function parseSheet(name: string, sheet: XLSX.WorkSheet): ParsedSheet {
	const rows = new Map<number, Map<number, string>>();
	const issues: Issue[] = [];
	const conflictRows = new Set<number>();
	let maxColumn = 0;
	/**
	 * 向指定行列写入文本，同时维护实际出现过的最大列下标。
	 * 按需创建行映射，不为工作表声明但没有实际内容的大片空区域分配数组。
	 */
	const put = (r: number, c: number, value: string): void => {
		if (!rows.has(r))
			rows.set(r, new Map());
		rows.get(r)!.set(c, value);
		maxColumn = Math.max(maxColumn, c);
	};
	/**
	 * 只扫描普通单元格地址，跳过以感叹号命名的工作表元信息。
	 * 优先保留格式化显示文字，错误单元格用空文本占位并保存问题位置。
	 */
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
	/**
	 * 为每行建立独立 Map，后续展开合并区域不会覆盖这一份原始单元格证据。
	 * 行列编号仍为零开始，写入面向用户的问题和记录时才转换为一开始。
	 */
	const originalRows = new Map([...rows].map(([row, cells]) => [
		row,
		new Map(cells),
	]));
	/**
	 * 以合并区域左上角的文本填充整个区域，单个区域超过一百万格时拒绝展开。
	 * 遇到区域内已有且不等于左上角的非空文本时，记录冲突并隔离区域覆盖的全部行。
	 */
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
	/**
	 * 只将含有去除首尾空白后文本的行列为表头候选。
	 * 出现精确文字“位号”的行排在前面，其余行按不同非空文本的数量排列。
	 * 候选仅提供默认选择，最终表头行由界面传入，不在这里认定器件数据已经有效。
	 */
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

/**
 * 按从零开始的列下标生成稳定标识 col:下标，并保留 Excel 列字母供界面识别。
 * 空表头仍建立列，重名表头仍拥有不同标识，避免用表头文字作为键而覆盖数据。
 * 从首列到实际最大列之间的空列也保留，列的位置始终与来源文件一致。
 */
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

/**
 * 根据用户确认的表头、位号列、分隔符和大小写规则构造核对用清单。
 * 只处理表头之后含有可见内容的行，每个拆分位号产生一条记录。
 * 原始行号以一开始保存；同一来源行的多位号记录共享其只读用途的数据字典。
 * allowEmpty 仅允许返回空记录清单，不放宽表头和位号列的有效性检查。
 */
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
		/**
		 * 按完整字面分隔符拆分位号，并排除只包含不可见字符的结果。
		 * 冲突行另将原始位号加入存在性证据，这些记录仍标记无效，不能用于属性填充。
		 */
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
		/**
		 * 按列标识保存展开后的文本，同时生成相同列布局的原始数据字典。
		 * 没有实际单元格的位置统一为空字符串，保留所有已定义列，不根据单行内容删列。
		 */
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

/**
 * 将工程独有和清单独有记录输出为两个固定名称的 Excel 工作表。
 * 作者及文档属性读取集中身份定义，所有业务值转换为文本，保留编号前导零。
 * 没有有效位号的记录以及满足整行表头判定的记录不写入业务区域。
 * 空工作表只写状态文字；非空工作表汇总全部字段、建立筛选区域并设置有限列宽。
 */
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
		/**
		 * 只输出位号含可见字符的记录。位号等于“位号”时，继续检查整行是否只是字段名。
		 * 其他普通文本即使以等号开头，也作为单元格文本写出，不设置公式字段。
		 */
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
		/**
		 * 以位号列开头，按记录字段首次出现的顺序形成完整列集合。
		 * 不同记录没有的字段通过 scalarText 转为空文本，保证每一行与统一表头对齐。
		 */
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
