/**
 * 集中维护空状态、界面提示和含数量的确认文字。
 * 业务原始证据和异常原因由记录详情保留，短摘要只帮助理解当前状态。
 */
/**
 * 表格空状态结构，标题和说明分别作为文本节点显示，kind 决定样式类别。
 */
export interface EmptyState {
	/**
	 * 空状态主标题，解释当前表格为什么没有基础数据或匹配结果。
	 */
	title: string;
	/**
	 * 状态对应的操作说明，独立于标题控制阅读宽度和字号。
	 */
	description: string;
	/**
	 * 区分待操作、加载、错误、真实空结果和筛选空结果。
	 */
	kind: 'idle' | 'loading' | 'error' | 'empty' | 'filtered';
}

/**
 * 各页面共享状态字典，satisfies 检查每项结构且保留具体键类型。
 * 未核对、没有差异及筛选空结果分别保存，列头可见性由表格依据基础记录决定。
 */
export const emptyStates = {
	fileNone: { title: '等待导入清单', description: '请在导入设置中选择物料清单，核实解析设置后查看有效器件。', kind: 'idle' },
	fileLoading: { title: '正在读取清单', description: '正在解析并清洗清单数据，有效器件将在读取后完整展示。', kind: 'loading' },
	fileFailed: { title: '清单读取失败', description: '请在问题明细中查看原因，核实文件内容后重新导入清单。', kind: 'error' },
	previewPending: { title: '等待确定位号', description: '请在导入设置中选择表头与位号列，再查看清洗后的器件。', kind: 'idle' },
	previewEmpty: { title: '没有有效器件', description: '请核实表头、位号列及解析规则，排除原因保留在问题明细。', kind: 'empty' },
	noResult: { title: '等待核对器件', description: '请在导入设置中完成器件核对，此处将展示对应的差异记录。', kind: 'idle' },
	noWrites: { title: '等待预演写入', description: '请创建映射并选择来源及目标，预演后可核实属性原值与目标值。', kind: 'idle' },
	noIssues: { title: '当前没有问题', description: '解析、校验和执行中发现的问题将在此展示，有效数据继续处理。', kind: 'empty' },
	noOperations: { title: '等待执行操作', description: '属性写入或器件删除后，此处将展示实际结果与修改前原值。', kind: 'idle' },
	noDifference: { title: '当前没有差异', description: '该类别未发现有效差异记录，可切换其他页面查看完整核对结果。', kind: 'empty' },
	filteredEmpty: { title: '没有匹配记录', description: '当前筛选条件没有匹配的数据，请修改或清除列筛选条件。', kind: 'filtered' },
} satisfies Record<string, EmptyState>;

/**
 * 不含动态数量的短提示集合，页面模板与业务代码使用相同语义键。
 * 异常说明不承诺自动回滚，实际修改结果以宿主回读和操作日志为准。
 */
export const messages = {
	/**
	 * 配置变更及初始化对应的页面状态文字，这些提示自身不触发工程访问。
	 */
	invalidated: '核对配置已经变化。请重新核对器件后再执行工程操作。',
	initial: '正在读取工程范围。请等待范围就绪后导入清单。',
	ready: '工程范围读取成功。请导入清单并核实解析设置。',
	fileReady: '物料清单读取成功。请查看有效器件并执行核对。',
	checkReady: '器件核对已经完成。请查看差异或配置属性映射。',
	fileNone: '尚未导入物料清单。请在导入设置中选择文件。',
	referenceMissing: '未找到唯一位号列。请选择实际位号列后继续核对。',
	noResult: '尚无有效核对结果。请在导入设置中核对器件。',
	failed: '当前操作未能完成。请查看问题明细并按原因处理。',
	cancelFile: '文件选择已经取消。当前文件及有效配置保持不变。',
	exportSaved: '差异文件已交由宿主保存。请在所选位置核对文件。',
	logSaved: '操作日志已交由宿主保存。文件包含执行结果及原值。',
	/**
	 * 映射、来源及类型问题按目标字段隔离，计划中其余有效字段仍可继续。
	 */
	separatorInvalid: '合并分隔符包含不可见字符。请使用可见字符或留空。',
	mappingInvalid: '映射配置未通过校验。请选择有效且不重复的来源及目标。',
	invalidSource: '来源行未通过清洗。该目标属性已隔离，其他有效属性继续处理。',
	sourceConflict: '同位号来源列存在冲突。该目标属性已隔离，请核实来源行。',
	emptySource: '全部来源片段均为空。目标属性保持原值，未执行写入。',
	booleanInvalid: '目标属性需要明确布尔值。请使用真、假或受支持的布尔表示。',
	/**
	 * 文件、表头与位号清洗的诊断文字，行列位置和原始证据另存问题字段。
	 */
	emptySheet: '当前工作表没有有效数据。',
	chooseBom: '尚未选择有效清单。请导入文件后继续操作。',
	chooseScope: '处理范围尚未确定。请选择有效工程文档后继续操作。',
	chooseMapping: '尚未建立字段映射。请创建映射并选择来源及目标。',
	noScope: '工程没有可处理文档。请打开PCB或原理图后重载工程。',
	emptyHeader: '指定表头行没有内容。请重新选择实际表头所在行。',
	chooseReference: '位号列配置无效。请选择实际存放位号的数据列。',
	noRecords: '清单没有可核对的位号。请检查解析设置与问题明细。',
	noSheets: '文件没有可读取工作表。请核实文件内容后重新导入。',
	cellError: '单元格结果无效。该来源行已隔离，请核实公式或错误值。',
	mergeConflict: '合并单元格内容冲突。受影响来源行已隔离，请核实原始数据。',
	mergeTooLarge: '合并区域超过处理上限。请缩小至一百万个单元格以内。',
	repeatedHeader: '检测到重复表头。该行已排除，不作为器件记录。',
	emptyReference: '来源行没有有效位号。该行已排除，无法匹配工程器件。',
	/**
	 * 区分工程无位号、存在但不能唯一修改和双向差异说明。
	 */
	projectReferenceMissing: '工程器件没有有效位号。该器件已排除，不参与自动修改。',
	projectReferenceConflict: '工程位号无法唯一确定。该器件不参与自动填写或删除。',
	projectOnly: '该器件仅存在于工程。当前清单无法为其提供属性值。',
	bomOnly: '该器件仅存在于清单。当前工程没有可填写的对应器件。',
	/**
	 * 删除前置拒绝与用户取消的说明，实际服务在提交删除前检查这些条件。
	 */
	noDelete: '没有符合删除条件的器件。请核对差异与问题记录。',
	unsafeDelete: '清单解析存在异常。位号集合未确认完整，禁止删除器件。',
	writeCancelled: '属性写入已经取消。整批目标属性均未修改。',
	deleteCancelled: '器件删除已经取消。整批目标器件均未删除。',
	/**
	 * 执行前身份检查、字段检查与回读结果使用的文字，具体前后值由日志保存。
	 */
	identityChanged: '器件身份已经变化。该器件已跳过，未执行工程修改。',
	valueChanged: '目标属性已经变化。该字段已跳过，请重新核对后处理。',
	writeVerified: '目标属性写入成功。已重新读取并核对实际值。',
	writeMismatch: '目标属性回读不符。请核实宿主实际值与目标值。',
	deleteVerified: '目标器件删除成功。已重新读取并确认器件不存在。',
	deleteRemains: '目标器件仍然存在。删除未通过回读核验，请查看详情。',
	/**
	 * 工程及文档加载、切换、稳定读取和图元缺失的诊断文字。
	 */
	projectClosed: '尚未打开工程文档。请打开工程及设计文档后重载工程。',
	projectLoading: '当前工程尚未就绪。请等待加载完成后重载工程。',
	projectChanged: '当前工程已经切换。请重载工程并重新核对器件。',
	documentFailed: '目标文档无法打开。请检查文档状态后重新核对。',
	documentTimeout: '目标文档加载超时。请等待文档就绪后重新核对。',
	documentChanged: '当前文档与范围不符。工程操作已停止，请重新核对。',
	documentUnstable: '文档器件仍在加载。请等待内容稳定后重新核对。',
	componentMissing: '目标器件已经不存在。请重新核对当前工程内容。',
	writeNoResponse: '宿主没有返回修改结果。请核实实际属性后重新核对。',
	crossDocument: '删除目标跨越多个文档。请按文档分批提交操作。',
	/**
	 * 保存、恢复数据持久化和窗口打开失败的说明，均由实际接口结果触发。
	 */
	saveFailed: '宿主未能保存文档。请手动保存并核实当前工程状态。',
	recoveryFailed: '修改前原值记录失败。工程修改未执行，请检查存储状态。',
	windowFailed: '扩展窗口无法打开。请重新导入扩展包后再次启动。',
	writeConfirmTitle: '属性写入确认',
	deleteConfirmTitle: '工程删除确认',
};

/**
 * 动态文字只格式化调用方计数，不保存或自行推断业务结果。
 */
export const notices = {
	/**
	 * 有效记录计拆分位号，来源计不同原始行，两种数量分别呈现。
	 */
	preview: (count: number, rows: number) => `已展示 ${count} 条有效器件记录，来源 ${rows} 行。全部实际数据列均可查看。`,
	/**
	 * 工程计图元，BOM 和匹配计不同位号，双向差异计各自实际输出记录。
	 */
	checked: (project: number, bom: number, matched: number, extra: number, missing: number) => `按位号核对：工程 ${project} 个图元，清单 ${bom} 个位号，匹配 ${matched} 个。工程独有 ${extra} 个，清单独有 ${missing} 个。`,
	/**
	 * 写入项计图元，覆盖及无需修改计字段，预演数量不是已执行数量。
	 */
	writes: (count: number, overwrite: number, unchanged: number) => `写入预演：有效器件 ${count} 个，已有值替换 ${overwrite} 个字段，无需修改 ${unchanged} 个字段。请核实后写入属性。`,
	progress: (done: number, total: number) => `正在处理工程器件：${done} / ${total}。执行结果将在操作日志中完整记录。`,
	read: (done: number, total: number) => `正在读取工程文档：${done} / ${total}。全部文档就绪后生成核对结果。`,
	issues: (count: number) => `检查发现 ${count} 条问题记录。详情已集中列出，其他有效数据继续处理。`,
	/**
	 * 按调用方分类后的结果行显示完成数量，保存失败也由调用方计入失败。
	 */
	finished: (action: string, success: number, skipped: number, failed: number) => `${action}结果：成功 ${success} 条，跳过 ${skipped} 条，失败 ${failed} 条。详情见操作日志，再次操作前请重新核对。`,
	separator: (valid: number, empty: number, duplicate: number) => `分隔符状态：有效 ${valid} 个，待填 ${empty} 个，重复 ${duplicate} 个。${empty ? '填完当前空行后可继续添加。' : '有效内容按完整字面值拆分位号。'}`,
	/**
	 * 显示覆盖图元与字段数量，确认后执行所有有效变化而不只覆盖字段。
	 */
	confirmWrite: (components: number, fields: number) => `写入范围：${components} 个器件图元，替换 ${fields} 个已有值字段。\n确认后执行全部有效映射，放弃后整批不写入。`,
	/**
	 * 显示类型、范围文档数及完整候选图元数，筛选不会缩小真正删除目标。
	 */
	confirmDelete: (kind: string, documents: number, count: number) => `删除范围：${kind}，${documents} 份文档，共 ${count} 个器件图元。\n确认后实际删除完整差异集合，筛选不改变删除范围；放弃后整批不删除。`,
};
