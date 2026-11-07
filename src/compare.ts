/**
 * 按位号建立清单与工程的存在性索引，并生成可执行的字段写入计划。
 * 差异检查与写入计划分别计算，来源无效不会消除已经存在的位号证据。
 * 此模块仅处理快照和数据，不调用宿主修改接口，也不替用户确认覆盖。
 */
import type { BomData, BomRecord, Comparison, ComponentSnapshot, Mapping, Scalar, TargetField, WritePlan } from './model';
import { messages } from './messages';
import { fieldValue, hasVisible, mappingSeparator, referenceKey, scalarText, validJoinSeparator } from './rules';

/**
 * 分别建立工程位号分组和 BOM 位号分组，使用清单指定的大小写规则。
 * 工程无位号对象记入问题；工程重号分组记录歧义，但仍保留存在性索引。
 * 返回双向差异、按不同位号计算的匹配数量，以及后续写入计划使用的两份分组。
 */
export function compare(bom: BomData, components: ComponentSnapshot[]): Comparison {
	const groups = new Map<string, ComponentSnapshot[]>();
	const bomIndex = new Map<string, BomRecord[]>();
	const issues = [...bom.issues];
	/**
	 * 工程快照按规范化位号归组，同位号的多个图元保留为数组。
	 * 没有有效匹配键时仅记录工程问题，不把它加入可自动匹配的分组。
	 */
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
	/**
	 * 清单所有已展开记录均加入索引，包括携带存在性证据的无效来源。
	 * 重复位号不在此处合并字段值，冲突检测由写入计划针对每个来源列执行。
	 */
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
	/**
	 * 工程独有集合按照完整快照筛选；清单无效记录仍能证明某位号存在。
	 * 清单独有集合只输出有效来源记录，因此同位号的多条有效来源仍分别保留。
	 */
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

/**
 * 单个图元直接视为明确分组；多个图元要求共享非空唯一标识。
 * 多图元还必须各自具有非空且互不相同的单元名，满足条件才允许按一个器件的各单元处理。
 * 空分组、唯一标识不同、缺少单元名和重复单元名均返回 false。
 */
export function isUnambiguousGroup(group: ComponentSnapshot[]): boolean {
	if (group.length === 1)
		return true;
	return group.length > 1 && Boolean(group[0].uniqueId)
		&& group.every(component => component.uniqueId === group[0].uniqueId && Boolean(component.subPart))
		&& new Set(group.map(component => component.subPart)).size === group.length;
}

/**
 * 文本目标保留来源的完整显示文字。布尔目标去除首尾空白后只识别明确词汇。
 * true、1、是转换为真；false、0、否转换为假，英文不区分大小写。
 * 其他输入抛出清洗错误，包括空字符串，不把任意非空文本当作真值。
 */
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

/**
 * 先验证映射目标、来源列及分隔符，再逐匹配位号和工程图元计算字段变化。
 * 每个目标属性只允许一个映射，同一映射中的来源列不能重复。
 * 无效来源、列冲突和类型转换错误只阻止对应字段，其他有效字段继续组成写入项。
 * 返回覆盖字段数、无需修改字段数、具体前后值和问题记录，不执行任何工程写入。
 */
export function planWrites(result: Comparison, mappings: Mapping[], fields: TargetField[], clearEmpty: boolean): WritePlan {
	const plan: WritePlan = {
		items: [],
		issues: [...result.issues],
		overwriteCount: 0,
		unchangedCount: 0,
	};
	/**
	 * 预先统计目标出现次数，使重复目标映射的全部成员都不能进入有效集合。
	 * 目标存在、来源非空、各来源确实存在且不重复时，才继续验证实际使用的分隔符。
	 */
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
	/**
	 * 仅处理同时存在 BOM 来源且工程分组明确的位号。
	 * 原理图的不同单元分别生成写入项，保留各自文档、图元身份和原值。
	 */
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
				/**
				 * 逐来源列收集同位号全部记录的不同文本值，同时保存来源行号和列标签。
				 * 每列必须只有一种文本值，即使多个列拼接后的结果碰巧相同，也不能掩盖列内冲突。
				 */
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
				/**
				 * 只有包含可见字符的片段参与按序拼接，空片段不产生额外分隔符。
				 * 结果为空且未允许清空时记录跳过问题；允许清空时仍需满足目标字段的类型约束。
				 */
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
					/**
					 * 先转换为目标类型，再与当前快照按文本表示比较。
					 * 相同值只增加无需修改计数；不同值才保存前后值，原值可见时计为需要确认的覆盖。
					 */
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
