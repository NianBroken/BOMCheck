/** 真实界面验收文件覆盖偏移表头、合并区域、错误范围和多个字面分隔符。 */
import fs from 'node:fs/promises';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';

async function main() {
	const directory = 'tests/output';
	const workbook = XLSX.utils.book_new();
	const rows = [];
	rows[0] = ['偏移表头与合并单元格验收'];
	rows[20] = [
		'',
		'',
		'',
		'',
		'Reference',
		'描述源',
		'编号源',
		'描述源',
	];
	rows[21] = [
		'',
		'',
		'',
		'',
		'C54||C55',
		'共同描述',
		'000006',
		'重复表头列',
	];
	rows[22] = [
		'',
		'',
		'',
		'',
		'c54;;C55',
		'',
		'000006',
		'重复表头列',
	];
	const sheet = XLSX.utils.aoa_to_sheet(rows);
	sheet['!merges'] = [
		{
			s: { r: 0, c: 0 },
			e: { r: 0, c: 7 },
		},
		{
			s: { r: 21, c: 5 },
			e: { r: 22, c: 5 },
		},
	];
	XLSX.utils.book_append_sheet(workbook, sheet, '偏移表头');
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
		['位号', '描述'],
		['C54', '默认表'],
		['C55', '默认表'],
	]), '默认表');
	const conflict = XLSX.utils.aoa_to_sheet([
		['位号', '描述'],
		['C54', '原始内容'],
		['C55', '冲突内容'],
	]);
	conflict['!merges'] = [
		{
			s: { r: 1, c: 1 },
			e: { r: 2, c: 1 },
		},
	];
	XLSX.utils.book_append_sheet(workbook, conflict, '合并冲突');
	const zip = await JSZip.loadAsync(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
	const xmlFile = 'xl/worksheets/sheet1.xml';
	zip.file(xmlFile, (await zip.file(xmlFile).async('string')).replace(/<dimension ref="[^"]+"\/>/, '<dimension ref="A1"/>'));
	await fs.writeFile(`${directory}/UI_复杂结构.xlsx`, await zip.generateAsync({ type: 'nodebuffer' }));
	const plain = XLSX.utils.book_new();
	XLSX.utils.book_append_sheet(plain, XLSX.utils.aoa_to_sheet([
		['位号', '描述'],
		['C54,C55', '格式验收'],
	]), '格式验收');
	await fs.writeFile(`${directory}/UI_旧格式.xls`, XLSX.write(plain, { type: 'buffer', bookType: 'biff8' }));
	await fs.writeFile(`${directory}/UI_制表符.tsv`, '\uFEFF位号\t描述\r\nC54、C55\t格式验收\r\n', 'utf8');
	await fs.writeFile(`${directory}/UI_损坏文件.xlsx`, (await zip.generateAsync({ type: 'nodebuffer' })).subarray(0, 80));

	/** 相同控件流程在两个真实客户端分别运行，每份操作记录带有版本来源。 */
	for (const version of ['3.2', '4.1']) {
		const load = filename => [
			{ click: 'choose' },
			{ file: `${directory}/${filename}` },
		];
		const mapDescription = {
			map: ['B · 测试描述', '更多属性 / 描述'],
		};
		const mapSupplier = {
			map: ['C · 测试编号', '关键属性 / 供应商编号'],
			index: 1,
		};
		const complete = [
			{ wait: '批次结束' },
		];
		const executeConfirmed = [
			{ click: 'run' },
			{ dialog: '确认批量覆盖' },
			{ button: '确定' },
			...complete,
		];
		const record = name => [
			{ click: 'exportRecord' },
			{ save: `${directory}/${version}_UI_${name}.json` },
		];
		const flow = [
			...load('UI_清空验收.csv'),
			{ click: 'start' },
			mapDescription,
			{ click: 'run' },
			...complete,
			...record('空值跳过'),
			{ toggle: 'clearEmpty', value: 1 },
			{ click: 'start' },
			...executeConfirmed,
			...record('选择清空'),
			...load('UI_错误隔离.csv'),
			{ click: 'start' },
			mapDescription,
			mapSupplier,
			...executeConfirmed,
			...record('错误隔离'),
			...load('UI_复杂结构.xlsx'),
			{ select: '工作表', value: '偏移表头' },
			{ wait: '自动搜索未找到' },
			{ shot: `${directory}/screenshots/native-${version}-manual-reference.png` },
			{ edit: 'header', kind: 'Spinner', value: '21' },
			{ select: '位号列', value: 'E · Reference' },
			{
				edit: '',
				name: '字面分隔符',
				value: '||',
				index: 0,
			},
			{
				edit: '',
				name: '字面分隔符',
				value: ';;',
				index: 1,
			},
			{
				edit: '',
				name: '字面分隔符',
				value: '',
				index: 2,
			},
			{ click: 'start' },
			{ wait: '核对完成' },
			{ shot: `${directory}/screenshots/native-${version}-custom-separators.png` },
			{ toggle: 'ignoreCase', value: 1 },
			{ click: 'start' },
			{ wait: '核对完成' },
			{ select: '工作表', value: '合并冲突' },
			{ click: 'resetSeparators' },
			{ click: 'start' },
			{ wait: '核对完成' },
			{ click: 'delete' },
			{ wait: '禁止删除' },
			{ toggle: 'ignoreCase', value: 0 },
			...load('UI_旧格式.xls'),
			{ click: 'start' },
			{ wait: '核对完成' },
			...load('UI_制表符.tsv'),
			{ click: 'start' },
			{ wait: '核对完成' },
			{ shot: `${directory}/screenshots/native-${version}-tsv.png` },
		];
		await fs.writeFile(`${directory}/flow-matrix-${version}.json`, JSON.stringify(flow, null, 2), 'utf8');
	}
}

void main();
