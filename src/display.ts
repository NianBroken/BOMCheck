import type { BomData, BomRecord, ComponentSnapshot } from './model';
import { messages } from './messages';
import { scalarText } from './rules';

/** 详情、界面与导出共享相同的完整记录转换，避免遗漏某一种输出的属性。 */
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

/** 数据预览逐来源器件展开，完整保留列与原始行，异常行只进入问题记录。 */
export function previewRows(bom: BomData): Record<string, unknown>[] {
	return bom.records.filter(record => record.valid).map(record => ({
		位号: record.designator,
		来源文件: bom.file,
		工作表: bom.sheet,
		原始行号: record.row,
		...Object.fromEntries(bom.columns.map(column => [column.label, record.values[column.id]])),
	}));
}
