/**
 * 物料清单、工程快照、映射计划和执行记录之间的共享数据契约，解析层、界面层与操作层都通过这些结构传递数据。
 * 工作表内部行列坐标从零开始，面向读者的来源行号从一开始；进入问题和操作记录时保留读者可核对的行号。
 * 工程快照保存宿主对象的身份文字和属性副本，执行前再按工程、文档及图元标识重新读取，不跨阶段持有宿主对象。
 * 这些类型只约束普通数据的形状，不包含读写工程的行为，也不表示计划中的修改已经提交。
 */
/** 可写与展示字段使用的简单值集合；数字和布尔值保持原类型，空值保留 null 或 undefined，需要显示时再显式转换。 */
export type Scalar = string | number | boolean | null | undefined;
/** 按字段键保存简单值；标准属性、普通属性和清单列通过所属结构区分，不在字典内部另存分类。 */
export type Values = Record<string, Scalar>;

export interface Issue {
	/** 问题产生的处理阶段文本，例如解析、清洗、匹配、映射或执行；该字段不限制为固定枚举。 */
	stage: string;
	/** 面向读者的简短诊断文字，具体冲突值或异常原文可另外保存在 detail。 */
	message: string;
	/** 来源文件中从一开始的行号；工程级、映射级或整批问题没有来源行时省略。 */
	row?: number;
	/** 与问题相关的显示位号或规范化匹配键，具体采用哪一种由产生问题的处理阶段决定。 */
	designator?: string;
	/** 相关列标识、单元格地址或目标字段标签，供界面定位问题涉及的数据。 */
	field?: string;
	/** 工程文档显示名称；一个问题关联多个文档时由调用方组合成文本。 */
	document?: string;
	/** 完整冲突证据或异常原因文本，通常保留原始值或异常信息以供详情核对。 */
	detail?: string;
}

export interface BomColumn {
	/** 按列位置生成的稳定键，例如 col:0，不使用表头文字充当唯一键。 */
	id: string;
	/** 从零开始的原始列下标。 */
	index: number;
	/** 表头单元格去除首尾空白后的文字，空表头保留为空文本。 */
	header: string;
	/** 包含 Excel 列字母和表头的界面名称，用于区分重名列。 */
	label: string;
}

export interface ParsedSheet {
	/** 来源工作表的原始名称。 */
	name: string;
	/** 合并区域展开后的稀疏数据，外层键为零开始的行号，内层键为零开始的列号；未出现的单元格不占用 Map 条目。 */
	rows: Map<number, Map<number, string>>;
	/** 展开前各单元格的独立副本；构造 BOM 时用它保留合并区域覆盖前的实际来源证据。 */
	originalRows: Map<number, Map<number, string>>;
	/** 写入或展开涉及的最大列下标，列定义从零到该值连续生成，中间空列也保留。 */
	maxColumn: number;
	/** 按推荐顺序排列的表头候选行号，内部采用零开始编号，仅供界面预选，不代表候选已经通过业务验证。 */
	candidates: number[];
	/** 单元格错误、公式结果缺失和合并冲突等解析问题。 */
	issues: Issue[];
	/** 不能用于属性填充的来源行集合，内部行号从零开始。 */
	conflictRows: Set<number>;
}

export interface BomRecord {
	/** 拆分并去除首尾空白后的单个位号显示值。 */
	designator: string;
	/** 按清单大小写规则生成的匹配键。 */
	key: string;
	/** 该记录在来源工作表中从一开始的行号。 */
	row: number;
	/** 以列稳定键保存的合并展开后值；同一行拆出的多个位号记录共享该数据字典的值。 */
	values: Values;
	/** 同列布局的原始单元格值，用于区分合并继承值与文件中的实际值，并提供详情及日志证据。 */
	originalValues: Values;
	/** 该来源行是否通过解析有效性检查；false 时记录仍进入位号存在性索引，但不能参与属性填充或清单独有导出。 */
	valid: boolean;
}

export interface BomData {
	/** 来源文件名，用于界面、详情及导出。 */
	file: string;
	/** 当前选用的工作表名。 */
	sheet: string;
	/** 按来源列顺序保存的完整列定义。 */
	columns: BomColumn[];
	/** 按来源行和拆分位号顺序保存的全部记录。 */
	records: BomRecord[];
	/** 解析和清洗过程中积累的问题集合。 */
	issues: Issue[];
	/** 本清单匹配位号时是否转为大写比较。 */
	ignoreCase: boolean;
}

export interface Scope {
	/** 范围标识，来自 PCB 或原理图 UUID。 */
	id: string;
	/** 面向界面的范围名称，不用于替代 UUID 定位。 */
	name: string;
	/** 决定调用 PCB 还是原理图公开接口。 */
	kind: 'pcb' | 'sch';
	/** 范围所属工程 UUID，后续访问前用于核对工程身份。 */
	projectId: string;
	/** 工程显示名，用于范围选项。 */
	projectName: string;
	/** 实际遍历的文档列表，PCB 为单文档，原理图为全部图页。 */
	documents: { id: string; name: string }[];
}

export interface ComponentSnapshot {
	/** 宿主图元标识，读取或修改时与 documentId 及范围类型共同定位对象。 */
	id: string;
	/** 图元所在文档或图页 UUID。 */
	documentId: string;
	/** 文档显示名，用于差异详情与执行日志。 */
	documentName: string;
	/** 快照所属工程 UUID。 */
	projectId: string;
	/** 宿主报告的位号，缺失时保存为空文本。 */
	designator: string;
	/** 用于执行前身份复核及原理图多单元归组的唯一标识；空值不提供可靠的多单元身份依据。 */
	uniqueId: string;
	/** 原理图单元名称，PCB 快照使用空文本。 */
	subPart: string;
	/** 标准名称、厂商、供应商及布尔开关等属性值。 */
	standard: Values;
	/** 宿主其他属性，供展示和普通字段映射使用；对象型值由宿主适配层转为文本后保存。 */
	other: Values;
	/** 位置、封装、网络和库关联等宿主信息，供详情及导出展示，不作为普通映射目标。 */
	metadata: Record<string, unknown>;
}

export interface TargetField {
	/** 映射目标的稳定标识，包含字段类别和键名。 */
	id: string;
	/** 界面及问题记录中的目标名称。 */
	label: string;
	/** 对应快照字典或宿主补丁中的实际属性键。 */
	key: string;
	/** 区分标准属性和其他属性，决定取值及补丁组织方式。 */
	kind: 'standard' | 'other';
	/** 决定写入计划按文本保留还是按明确布尔词转换。 */
	valueType: 'text' | 'boolean';
}

export interface MappingSource {
	/** 编辑器生成的来源行标识，仅用于操作控件和排列顺序。 */
	id: string;
	/** 所选 BOM 列的稳定键，写入计划据此查找真实来源列。 */
	columnId: string;
}

/** 一个目标属性对应一组有序来源，顺序就是文本合并顺序。 */
export interface Mapping {
	/** 映射组在编辑器中的稳定标识。 */
	id: string;
	/** 唯一的目标字段标识，同一目标不能被多个映射同时写入。 */
	fieldId: string;
	/** 按最终拼接顺序保存的来源列。 */
	sources: MappingSource[];
	/** 多来源拼接的字面分隔符草稿，单来源不使用该值。 */
	separator: string;
}

export interface Comparison {
	/** 生成该结果时使用的完整 BOM 和匹配配置。 */
	bom: BomData;
	/** 当前范围读取到的全部工程快照。 */
	components: ComponentSnapshot[];
	/** 位号不在 BOM 存在性索引中的工程图元。 */
	projectOnly: ComponentSnapshot[];
	/** 工程没有对应位号的有效 BOM 来源记录。 */
	bomOnly: BomRecord[];
	/** 同时出现在两侧索引中的不同位号数量，不是图元数量。 */
	matchedCount: number;
	/** 解析、清洗及工程匹配产生的问题。 */
	issues: Issue[];
	/** 工程匹配键到一个或多个图元快照的映射。 */
	groups: Map<string, ComponentSnapshot[]>;
	/** BOM 匹配键到所有来源记录的映射，包含无效来源的存在性证据。 */
	bomIndex: Map<string, BomRecord[]>;
}

export interface FieldChange {
	/** 该变化对应的目标字段定义。 */
	field: TargetField;
	/** 计划建立时快照中的原值，执行前再次核对。 */
	before: Scalar;
	/** 完成文本合并和类型转换后的最终目标值。 */
	after: string | boolean;
	/** 来源列标签、文本、可见性和来源行的证据，供日志查看。 */
	sources?: { column: string; value: string; used: boolean; rows: number[] }[];
	/** 本字段实际使用的分隔符，单来源时为空文本。 */
	separator?: string;
}

export interface WriteItem {
	/** 计划对应的工程快照，执行时按其身份重新读取。 */
	component: ComponentSnapshot;
	/** 该图元上实际需要变更的字段，合并为一次宿主修改请求。 */
	changes: FieldChange[];
}

export interface WritePlan {
	/** 有至少一个有效变化的图元写入项。 */
	items: WriteItem[];
	/** 原核对问题及映射、来源、类型转换问题。 */
	issues: Issue[];
	/** 原值包含可见字符的实际变化字段数，用于覆盖确认。 */
	overwriteCount: number;
	/** 前后文本表示一致而无需写入的字段数。 */
	unchangedCount: number;
}

export interface OperationRow {
	/** 对应器件位号，整批取消或保存结果没有单器件位号。 */
	位号: string;
	/** 器件文档名称或整批范围名称。 */
	文档: string;
	/** 单字段标签或异常时关联字段的组合文本。 */
	字段: string;
	/** 成功、失败、跳过、取消或保存失败等实际结果。 */
	结果: string;
	/** 对应结果的简短说明。 */
	说明: string;
	/** 写入计划中的修改前值文本。 */
	原值?: string;
	/** 计划提交的最终值文本。 */
	目标值?: string;
	/** 用于生成目标值的来源证据文本。 */
	合并来源?: string;
	/** 该目标值实际使用的合并分隔符。 */
	合并分隔?: string;
	/** 异常原因或删除核验信息。 */
	详情?: string;
}
