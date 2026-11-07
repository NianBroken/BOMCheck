/**
 * 定义跨模块共享的默认值、宿主字段目录与文本规则。
 * 位号匹配、空值判断、分隔符校验和字段取值均由同一组函数提供，保证预览与执行的判定一致。
 */
import type { ComponentSnapshot, Mapping, Scalar, TargetField } from './model';

/**
 * 初始位号分隔符为英文逗号、中文逗号和顿号；编辑器可替换该完整字面集合。
 */
export const DEFAULT_SEPARATORS = [',', '，', '、'];
/**
 * 初始匹配忽略位号大小写；清单保存实际选项，后续索引均读取该选项。
 */
export const DEFAULT_IGNORE_CASE = true;
/**
 * 宿主内嵌窗口的稳定标识，用于同一插件窗口的识别，不作为工程或图元身份。
 */
export const WINDOW_ID = 'bomcheck-main';
/**
 * 文件对话框返回焦点后等待一秒，使 change 事件有机会先报告实际文件。
 */
export const FILE_PICKER_SETTLE_MS = 1000;
/**
 * 单次工程或文档就绪等待的超时时间，单位为毫秒。
 */
export const DOCUMENT_TIMEOUT_MS = 60000;
/**
 * 批量写入按此间隔归还事件循环；序号从零开始，因此首项后也会归还。
 */
export const YIELD_INTERVAL = 20;
/**
 * 同一文档内每批最多读取并提交的删除器件数，控制批量接口的工作规模。
 */
export const DELETE_BATCH_SIZE = 40;
/**
 * 识别空白、控制、格式、代理码点、未分配字符与默认忽略字符。
 * 该表达式没有全局状态，可在多次 test 调用中稳定复用。
 */
const INVISIBLE_CHARACTERS = /[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}\p{Cn}\p{Default_Ignorable_Code_Point}]/u;

/**
 * 其他属性中的结构字段名称集合，这些键不进入可写的普通文本字段目录。
 * 键名按宿主实际拼写精确比较，关联信息仍保留在快照及详情中。
 */
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

/**
 * 标准字段用稳定 id 关联界面选项，key 对应宿主修改补丁中的属性名。
 * 名称及厂商供应商信息使用文本，加入 BOM 与转到 PCB 使用严格布尔转换。
 */
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

/**
 * 按 Unicode 码点逐个检查，存在至少一个不属于不可见集合的字符即返回真。
 * null 与 undefined 先转为空文本，数字 0 和布尔 false 转成文字后仍属于有效内容。
 */
export function hasVisible(value: Scalar): boolean {
	return Array.from(String(value ?? '')).some(character => !INVISIBLE_CHARACTERS.test(character));
}

/**
 * 只去除位号首尾空白，并在要求忽略大小写时转为大写。
 * 不会删掉内部空格、展开位号范围或替换相似字符，索引键始终遵循这一明确规则。
 */
export function referenceKey(value: string, ignoreCase: boolean): string {
	const trimmed = value.trim();
	return ignoreCase
		? trimmed.toUpperCase()
		: trimmed;
}

/**
 * 去掉空字符串并按完整字面值去重，然后按长度从长到短排序。
 * 相同长度用 localeCompare 排列；较长的重叠分隔符先参与匹配。
 */
export function effectiveSeparators(separators: string[]): string[] {
	return [
		...new Set(separators.filter(s => s.length > 0)),
	].sort((a, b) => b.length - a.length || a.localeCompare(b));
}

/**
 * 将每个分隔符中的正则特殊字符转义，再组合为字面匹配表达式。
 * 分片去除首尾空白、排除空片段并去重，保留首次出现顺序。
 * 分隔符集合为空时，整个非空文本只产生一个位号，不猜测逗号或其他符号的含义。
 */
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

/**
 * null 与 undefined 返回空文本，普通值使用 String 转换，对象使用 JSON 序列化。
 * 函数不捕获对象序列化异常，无法序列化的数据由调用方的异常路径处理。
 */
export function scalarText(value: unknown): string {
	if (value === null || value === undefined)
		return '';
	return typeof value === 'object'
		? JSON.stringify(value)
		: String(value);
}

/**
 * 从共享标准字段目录与工程快照的其他属性键生成映射目标。
 * Description 即使工程中没有出现也提供为文本目标，结构属性则统一排除。
 * 只有至少一个快照实际包含 addIntoPcb 标准键时，才提供转到 PCB 选项。
 */
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

/**
 * 根据字段类别读取标准或其他属性字典中的原始值，不在读取时清洗或转换。
 */
export function fieldValue(component: ComponentSnapshot, field: TargetField): Scalar {
	return field.kind === 'other'
		? component.other[field.key]
		: component.standard[field.key];
}

/**
 * Error 对象取其 message，其余异常值用 String 表示，供状态明细及日志记录。
 */
export function errorText(error: unknown): string {
	return error instanceof Error
		? error.message
		: String(error);
}

/**
 * 通过零延迟定时器进入后续事件循环，使界面绘制、进度和关闭事件能够获得执行机会。
 */
export async function yieldUi(): Promise<void> {
	await new Promise<void>(resolve => setTimeout(resolve, 0));
}

/**
 * 空字符串允许直接拼接；非空分隔符只要包含任一不可见字符就判无效。
 * 该规则按整个字符串检查，空格、换行、零宽字符及无效代理字符均不能作为合并分隔符。
 */
export function validJoinSeparator(value: string): boolean {
	return !INVISIBLE_CHARACTERS.test(value);
}

/**
 * 只有多来源组使用保存的分隔符草稿，单来源与无来源返回空字符串。
 * 因此单来源不会被暂存但当前隐藏的多来源分隔配置阻止。
 */
export function mappingSeparator(mapping: Pick<Mapping, 'sources' | 'separator'>): string {
	return mapping.sources.length > 1
		? mapping.separator
		: '';
}
