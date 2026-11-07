import type { BomData, BomRecord, Comparison, ComponentSnapshot, Mapping, Scalar, TargetField, WritePlan } from './model';
import { messages } from './messages';
import { fieldValue, hasVisible, mappingSeparator, referenceKey, scalarText, validJoinSeparator } from './rules';

/** 存在性索引不受属性清洗影响，映射错误不会把已有器件误判成缺失。 */
export function compare(bom: BomData, components: ComponentSnapshot[]): Comparison {
	const groups = new Map<string, ComponentSnapshot[]>();
	const bomIndex = new Map<string, BomRecord[]>();
	const issues = [...bom.issues];
	for (const component of components) {
		const key = referenceKey(component.designator, bom.ignoreCase);
		if (!key) {
			issues.push({
				stage: '工程',
				document: component.documentName,
				message: messages.projectReferenceMissing,
				detail: component.id,
			});
			continue;
		}
		groups.set(key, [
			...groups.get(key) ?? [],
			component,
		]);
	}
	for (const record of bom.records) {
		bomIndex.set(record.key, [
			...bomIndex.get(record.key) ?? [],
			record,
		]);
	}
	for (const [key, group] of groups) {
		if (!isUnambiguousGroup(group)) {
			issues.push({
				stage: '匹配',
				designator: key,
				message: messages.projectReferenceConflict,
				document: group.map(component => component.documentName).join('、'),
			});
		}
	}
	const projectOnly = components.filter(component => component.designator.trim() && !bomIndex.has(referenceKey(component.designator, bom.ignoreCase)));
	const bomOnly = [...bomIndex].filter(([key]) => !groups.has(key)).flatMap(([, records]) => records.filter(record => record.valid));
	const matchedCount = [
		...bomIndex.keys(),
	].filter(key => groups.has(key)).length;
	return {
		bom,
		components,
		projectOnly,
		bomOnly,
		matchedCount,
		issues,
		groups,
		bomIndex,
	};
}

/** 同位号的原理图单元只有共享非空唯一标识且单元名不同时，才视为一个器件。 */
export function isUnambiguousGroup(group: ComponentSnapshot[]): boolean {
	if (group.length === 1)
		return true;
	return group.length > 1 && Boolean(group[0].uniqueId)
		&& group.every(component => component.uniqueId === group[0].uniqueId && Boolean(component.subPart))
		&& new Set(group.map(component => component.subPart)).size === group.length;
}

/** 文本保留原显示值，布尔值只接受明确词汇，拒绝把任意非空字符串当作true。 */
function convertValue(value: Scalar, field: TargetField): string | boolean {
	const text = scalarText(value);
	if (field.valueType === 'text')
		return text;
	if (/^(?:true|1|是)$/i.test(text.trim()))
		return true;
	if (/^(?:false|0|否)$/i.test(text.trim()))
		return false;
	throw new Error(messages.booleanInvalid);
}

/** 来源逐列核实后按显式顺序合并，任一来源冲突只隔离对应目标属性。 */
export function planWrites(result: Comparison, mappings: Mapping[], fields: TargetField[], clearEmpty: boolean): WritePlan {
	const plan: WritePlan = {
		items: [],
		issues: [...result.issues],
		overwriteCount: 0,
		unchangedCount: 0,
	};
	const targetCounts = new Map<string, number>();
	for (const mapping of mappings) targetCounts.set(mapping.fieldId, (targetCounts.get(mapping.fieldId) ?? 0) + 1);
	const validMappings = mappings.flatMap((mapping) => {
		const field = fields.find(candidate => candidate.id === mapping.fieldId);
		const columns = mapping.sources.map(source => result.bom.columns.find(column => column.id === source.columnId));
		if (!field || !columns.length || columns.some(column => !column) || targetCounts.get(mapping.fieldId) !== 1
			|| new Set(mapping.sources.map(source => source.columnId)).size !== columns.length) {
			plan.issues.push({ stage: '映射', field: field?.label ?? mapping.fieldId, message: messages.mappingInvalid });
			return [];
		}
		const separator = mappingSeparator(mapping);
		if (!validJoinSeparator(separator)) {
			plan.issues.push({ stage: '映射', field: field.label, message: messages.separatorInvalid });
			return [];
		}
		return [
			{ mapping, field, separator },
		];
	});
	for (const [key, group] of result.groups) {
		const records = result.bomIndex.get(key);
		if (!records || !isUnambiguousGroup(group))
			continue;
		for (const component of group) {
			const changes = [];
			for (const { mapping, field, separator } of validMappings) {
				if (records.some(record => !record.valid)) {
					plan.issues.push({
						stage: '清洗',
						designator: component.designator,
						field: field.label,
						message: messages.invalidSource,
					});
					continue;
				}
				const sources = mapping.sources.map((source) => {
					const values = [
						...new Set(records.map(record => scalarText(record.values[source.columnId]))),
					];
					return {
						column: result.bom.columns.find(column => column.id === source.columnId)!.label,
						value: values[0],
						values,
						used: hasVisible(values[0]),
						rows: records.map(record => record.row),
						conflict: values.length !== 1,
					};
				});
				if (sources.some(source => source.conflict)) {
					plan.issues.push({
						stage: '清洗',
						designator: component.designator,
						field: field.label,
						message: messages.sourceConflict,
						detail: JSON.stringify(sources.filter(source => source.conflict)),
					});
					continue;
				}
				const combined = sources.filter(source => source.used).map(source => source.value).join(separator);
				if (!hasVisible(combined) && !clearEmpty) {
					plan.issues.push({
						stage: '跳过',
						designator: component.designator,
						field: field.label,
						message: messages.emptySource,
					});
					continue;
				}
				try {
					const after = convertValue(combined, field);
					const before = fieldValue(component, field);
					if (scalarText(before) === scalarText(after)) {
						plan.unchangedCount++;
						continue;
					}
					if (hasVisible(before))
						plan.overwriteCount++;
					changes.push({
						field,
						before,
						after,
						sources,
						separator,
					});
				}
				catch (error) {
					plan.issues.push({
						stage: '清洗',
						designator: component.designator,
						field: field.label,
						message: String(error),
					});
				}
			}
			if (changes.length)
				plan.items.push({ component, changes });
		}
	}
	return plan;
}
