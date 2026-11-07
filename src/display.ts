/**
 * 将工程快照和 BOM 来源转换为界面详情、差异表格及导出共用的平面记录。
 * 字段标签供读者识别，原始复杂值通过统一文本转换保留在详情中。
 */
import type { BomData, BomRecord, ComponentSnapshot } from './model';
import { messages } from './messages';
import { scalarText } from './rules';

/**
 * 输出图元身份、标准属性、其他属性和宿主元信息。
 * 标准与其他属性分别加前缀，降低同名业务字段与身份列相互覆盖的风险。
 * 末尾说明表明这是工程独有记录，调用方只在对应差异集合中使用该转换。
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
 * 查找同匹配键的全部有效来源，多来源时以结构化文本附带原始数据和展开后数据。
 * 原始单元格使用列标识保存，界面列使用含 Excel 列字母的标签展示。
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
 * 预览包含文件、工作表、一开始的来源行号及展开后的列值，不输出原始单元格字典。
 * 无效记录在此过滤，其原因由 BOM 问题集合单独展示。
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
