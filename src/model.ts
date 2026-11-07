/** BOM、工程快照和操作清单使用统一结构，原始字段始终随记录保存。 */
export type Scalar = string | number | boolean | null | undefined;
export type Values = Record<string, Scalar>;

export interface Issue {
	stage: string;
	message: string;
	row?: number;
	designator?: string;
	field?: string;
	document?: string;
	detail?: string;
}

export interface BomColumn {
	id: string;
	index: number;
	header: string;
	label: string;
}

export interface ParsedSheet {
	name: string;
	rows: Map<number, Map<number, string>>;
	originalRows: Map<number, Map<number, string>>;
	maxColumn: number;
	candidates: number[];
	issues: Issue[];
	conflictRows: Set<number>;
}

export interface BomRecord {
	designator: string;
	key: string;
	row: number;
	values: Values;
	originalValues: Values;
	valid: boolean;
}

export interface BomData {
	file: string;
	sheet: string;
	columns: BomColumn[];
	records: BomRecord[];
	issues: Issue[];
	ignoreCase: boolean;
}

export interface Scope {
	id: string;
	name: string;
	kind: 'pcb' | 'sch';
	projectId: string;
	projectName: string;
	documents: { id: string; name: string }[];
}

export interface ComponentSnapshot {
	id: string;
	documentId: string;
	documentName: string;
	projectId: string;
	designator: string;
	uniqueId: string;
	subPart: string;
	standard: Values;
	other: Values;
	metadata: Record<string, unknown>;
}

export interface TargetField {
	id: string;
	label: string;
	key: string;
	kind: 'standard' | 'other';
	valueType: 'text' | 'boolean';
}

export interface MappingSource {
	id: string;
	columnId: string;
}

/** 一个目标属性对应一组有序来源，顺序就是文本合并顺序。 */
export interface Mapping {
	id: string;
	fieldId: string;
	sources: MappingSource[];
	separator: string;
}

export interface Comparison {
	bom: BomData;
	components: ComponentSnapshot[];
	projectOnly: ComponentSnapshot[];
	bomOnly: BomRecord[];
	matchedCount: number;
	issues: Issue[];
	groups: Map<string, ComponentSnapshot[]>;
	bomIndex: Map<string, BomRecord[]>;
}

export interface FieldChange {
	field: TargetField;
	before: Scalar;
	after: string | boolean;
	sources?: { column: string; value: string; used: boolean; rows: number[] }[];
	separator?: string;
}

export interface WriteItem {
	component: ComponentSnapshot;
	changes: FieldChange[];
}

export interface WritePlan {
	items: WriteItem[];
	issues: Issue[];
	overwriteCount: number;
	unchangedCount: number;
}

export interface OperationRow {
	位号: string;
	文档: string;
	字段: string;
	结果: string;
	说明: string;
	原值?: string;
	目标值?: string;
	合并来源?: string;
	合并分隔?: string;
	详情?: string;
}
