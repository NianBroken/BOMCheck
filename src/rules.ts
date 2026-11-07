import type { ComponentSnapshot, Mapping, Scalar, TargetField } from './model';

/** 明确要求的默认值及宿主字段定义集中维护，环境路径由运行时获取。 */
export const DEFAULT_SEPARATORS = [',', '，', '、'];
export const DEFAULT_IGNORE_CASE = true;
export const WINDOW_ID = 'bomcheck-main';
export const FILE_PICKER_SETTLE_MS = 1000;
export const DOCUMENT_TIMEOUT_MS = 60000;
export const YIELD_INTERVAL = 20;
export const DELETE_BATCH_SIZE = 40;
const INVISIBLE_CHARACTERS = /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Cn}\p{Default_Ignorable_Code_Point}]/u;

/** 这些属性属于库关联和结构元数据，展示原值但不作为普通文本填充目标。 */
export const STRUCTURAL_KEYS = new Set([
	'Device',
	'Symbol',
	'Footprint',
	'Designator',
	'Unique ID',
	'UniqueId',
	'3D Model',
	'3D Model Transform',
	'3D Model Title',
	'Origin 3D Model Title',
	'PCB Layer',
	'Relevance',
	'Multi-Part Group',
	'Hierarchical Path',
	'Hierarrchical Path',
	'Channel Offset',
	'LibraryName',
	'SCH Library',
	'Library Ref',
]);

export const STANDARD_FIELDS: TargetField[] = [
	{
		id: 'standard:name',
		label: '关键属性 / 名称',
		key: 'name',
		kind: 'standard',
		valueType: 'text',
	},
	{
		id: 'standard:manufacturer',
		label: '关键属性 / 制造商',
		key: 'manufacturer',
		kind: 'standard',
		valueType: 'text',
	},
	{
		id: 'standard:manufacturerId',
		label: '关键属性 / 制造商编号',
		key: 'manufacturerId',
		kind: 'standard',
		valueType: 'text',
	},
	{
		id: 'standard:supplier',
		label: '关键属性 / 供应商',
		key: 'supplier',
		kind: 'standard',
		valueType: 'text',
	},
	{
		id: 'standard:supplierId',
		label: '关键属性 / 供应商编号',
		key: 'supplierId',
		kind: 'standard',
		valueType: 'text',
	},
	{
		id: 'standard:addIntoBom',
		label: '关键属性 / 加入BOM',
		key: 'addIntoBom',
		kind: 'standard',
		valueType: 'boolean',
	},
	{
		id: 'standard:addIntoPcb',
		label: '关键属性 / 转到PCB',
		key: 'addIntoPcb',
		kind: 'standard',
		valueType: 'boolean',
	},
];

/** 空白和Unicode默认不可见字符不构成覆盖，0和false仍然含有可见字符。 */
export function hasVisible(value: Scalar): boolean {
	return Array.from(String(value ?? '')).some(character => !INVISIBLE_CHARACTERS.test(character));
}

export function referenceKey(value: string, ignoreCase: boolean): string {
	const trimmed = value.trim();
	return ignoreCase
		? trimmed.toUpperCase()
		: trimmed;
}

/** 按完整字面分隔符从长到短匹配，不把用户输入当作正则表达式。 */
export function effectiveSeparators(separators: string[]): string[] {
	return [
		...new Set(separators.filter(s => s.length > 0)),
	].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/** 空行不参与解析，空格及多字符分隔符均保留其完整字面含义。 */
export function splitReferences(value: string, separators: string[]): string[] {
	const effective = effectiveSeparators(separators);
	if (!effective.length) {
		return value.trim()
			? [
					value.trim(),
				]
			: [];
	}
	const escaped = effective.map(s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
	return [
		...new Set(value.split(new RegExp(escaped.join('|'), 'u')).map(s => s.trim()).filter(Boolean)),
	];
}

export function scalarText(value: unknown): string {
	if (value === null || value === undefined)
		return '';
	return typeof value === 'object'
		? JSON.stringify(value)
		: String(value);
}

/** 字段列表包含宿主支持的标准属性，以及工程中实际存在的普通其他属性。 */
export function targetFields(components: ComponentSnapshot[]): TargetField[] {
	const keys = new Set(['Description']);
	for (const component of components)
		Object.keys(component.other).forEach(key => keys.add(key));
	return [
		...STANDARD_FIELDS.filter(field => field.key !== 'addIntoPcb' || components.some(component => Object.hasOwn(component.standard, 'addIntoPcb'))),
		...[...keys].filter(key => !STRUCTURAL_KEYS.has(key)).sort().map(key => ({
			id: `other:${key}`,
			label: `更多属性 / ${key === 'Description'
				? '描述'
				: key}`,
			key,
			kind: 'other' as const,
			valueType: 'text' as const,
		})),
	];
}

export function fieldValue(component: ComponentSnapshot, field: TargetField): Scalar {
	return field.kind === 'other'
		? component.other[field.key]
		: component.standard[field.key];
}

export function errorText(error: unknown): string {
	return error instanceof Error
		? error.message
		: String(error);
}

/** 分片之间归还事件循环，保证进度、关闭请求和浏览器绘制能够处理。 */
export async function yieldUi(): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, 0));
}

/** 空字符串代表直接拼接，非空分隔符的每个字符都必须可见且Unicode有效。 */
export function validJoinSeparator(value: string): boolean {
	return !INVISIBLE_CHARACTERS.test(value);
}

/** 单来源不使用分隔符，多来源按组内草稿执行；隐藏草稿不参与单列校验和日志。 */
export function mappingSeparator(mapping: Pick<Mapping, 'sources' | 'separator'>): string {
	return mapping.sources.length > 1
		? mapping.separator
		: '';
}
