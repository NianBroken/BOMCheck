/**
 * 将工程快照和 BOM 来源转换为界面详情、差异表格及导出共用的平面记录。
 * 字段标签供读者识别，原始复杂值通过统一文本转换保留在详情中。
 */
import type { BomData, BomRecord, ComponentSnapshot } from './model';
import { messages } from './messages';
import { scalarText } from './rules';

/**
 * 输出图元身份、标准属性、其他属性和宿主元信息，组成可供表格、详情及 Excel 使用的普通记录。
 * 标准属性键加“关键属性/”前缀，其他属性键加“更多属性/”前缀，降低两类业务字段之间的重名概率。
 * 元信息对象在两个属性字典之后展开，因此若它包含同名键，会按对象展开顺序覆盖先前字段；宿主快照的元信息键由固定采集代码提供。
 * 末尾说明标记该行的工程独有来源，具体差异集合由调用方筛选，本函数本身不重新比较位号。
 */
export function componentRow(component: ComponentSnapshot): Record<string, unknown> {
	return {
		位号: component.designator,
		工程标识: component.projectId,
		文档: component.documentName,
		文档标识: component.documentId,
		图元标识: component.id,
		唯一标识: component.uniqueId,
		单元: component.subPart,
		...Object.fromEntries(Object.entries(component.standard).map(([key, value]) => [`关键属性/${key}`, value])),
		...Object.fromEntries(Object.entries(component.other).map(([key, value]) => [`更多属性/${key}`, value])),
		...component.metadata,
		说明: messages.projectOnly,
	};
}

/**
 * 输出单条来源记录及当前文件、工作表、来源行和完整列值。
 * 查找同匹配键的全部有效来源，多来源时以 JSON 文本附带每行的原始数据和合并展开后的数据。
 * 当前记录的列值使用面向读者的 Excel 列标签作为键；原始值仍按稳定列标识保存在来源记录中。
 * 多来源信息只包含有效记录，当前记录即使无效仍会由调用方传入并显示其自身字段。
 */
export function bomRow(record: BomRecord, bom: BomData): Record<string, unknown> {
	const sources = bom.records.filter(candidate => candidate.key === record.key && candidate.valid);
	return {
		位号: record.designator,
		BOM文件: bom.file,
		工作表: bom.sheet,
		来源行: record.row,
		...Object.fromEntries(bom.columns.map(column => [column.label, record.values[column.id]])),
		原始单元格: scalarText(record.originalValues),
		全部来源记录: sources.length > 1
			? scalarText(sources.map(source => ({ 行: source.row, 展开后数据: source.values, 原始数据: source.originalValues })))
			: '',
		说明: messages.bomOnly,
	};
}

/**
 * 将所有有效 BOM 记录逐条转换为预览行，拆分后的每个位号都独立展示。
 * 预览包含文件、工作表、一开始的来源行号及合并展开后的列值，不输出原始单元格字典。
 * 无效记录在此过滤，其原因由 BOM 问题集合单独展示；重复位号的有效记录仍按每个拆分位号分别生成预览行。
 */
export function previewRows(bom: BomData): Record<string, unknown>[] {
	return bom.records.filter(record => record.valid).map(record => ({
		位号: record.designator,
		来源文件: bom.file,
		工作表: bom.sheet,
		原始行号: record.row,
		...Object.fromEntries(bom.columns.map(column => [column.label, record.values[column.id]])),
	}));
}
