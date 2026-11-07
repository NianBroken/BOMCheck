/**
 * 内嵌窗口的业务编排入口，连接文件解析、工程范围、位号差异、属性填充与执行日志。
 * 当前文件、核对结果及任务锁集中保存，配置变化使相关结果失效。
 * 各业务服务提供处理规则，页面组织调用、展示状态并在关闭时释放资源。
 */
import type { EmptyState } from './messages';
import type { BomData, Comparison, Issue, OperationRow, ParsedSheet, Scope, TargetField, WritePlan } from './model';
import { operationLog } from '../export-info.mjs';
import { buildBom, exportTables, loadWorkbook, sheetColumns } from './bom';
import { compare, planWrites } from './compare';
import { bomRow, componentRow, previewRows } from './display';
import { FilePicker } from './file-picker';
import { EdaHost } from './host';
import { MappingEditor } from './mapping-editor';
import { emptyStates, messages, notices } from './messages';
import { extensionInfo } from './metadata';
import { executeDelete, executeWrites } from './operations';
import { DEFAULT_IGNORE_CASE, DEFAULT_SEPARATORS, errorText, scalarText, targetFields } from './rules';
import { Scrollbars } from './scrollbars';
import { SeparatorEditor } from './separators';
import { DataTable } from './table';
import { Tabs } from './tabs';

/** 窗口状态只保存一份有效结果，任何输入变化都会使修改入口失效。 */
const host = new EdaHost(eda);
const filePicker = new FilePicker();
/**
 * 窗口级状态保存文件字节、解析工作表、工程结果、字段目录和执行记录。
 * 文件对象与字节分开保存，切换编码可以重用原字节；busy 阻止多个受控任务重叠。
 * closed 只标记窗口生命周期，不作为中途取消已经提交宿主操作的事务开关。
 */
const state: {
	scopes: Scope[];
	sheets: ParsedSheet[];
	file?: File;
	bytes?: ArrayBuffer;
	result?: Comparison;
	fields: TargetField[];
	busy: boolean;
	closed: boolean;
	plan?: WritePlan;
	operation: OperationRow[];
	issues: Issue[];
} = {
	scopes: [],
	sheets: [],
	fields: [],
	busy: false,
	closed: false,
	operation: [],
	issues: [],
};

/**
 * 按 id 获取必需控件，缺失时立即抛出结构错误。类型参数只表达调用方约定，不转换节点类别。
 */
function element<T extends HTMLElement>(id: string): T {
	const target = document.getElementById(id);
	if (!target)
		throw new Error(`界面控件不存在：${id}`);
	return target as T;
}
const select = (id: string): HTMLSelectElement => element<HTMLSelectElement>(id);
const input = (id: string): HTMLInputElement => element<HTMLInputElement>(id);
/**
 * 以容器 id 管理表格包装，各表共用详情回调和滚动层管理器，真实表格在可见时才创建。
 */
const tables = new Map<string, DataTable>();
const scrollbars = new Scrollbars();
for (const panel of document.querySelectorAll<HTMLElement>('[role=tabpanel]')) scrollbars.attach(panel);
scrollbars.attach(element('detailScroll'));

/**
 * 将完整记录逐项写为文本节点，对象由统一序列化显示，业务文字不作为 HTML 执行。
 * 打开原生对话框后更新详情视口的覆盖滚动层。
 */
function detail(record: Record<string, unknown>): void {
	const content = element('detailContent');
	content.replaceChildren();
	for (const [key, value] of Object.entries(record)) {
		const term = document.createElement('dt');
		term.textContent = key;
		const description = document.createElement('dd');
		description.textContent = scalarText(value);
		content.append(term, description);
	}
	element<HTMLDialogElement>('detail').showModal();
	scrollbars.update();
}

/**
 * 为预览、双向差异、问题、日志和写入预演建立六个独立表格包装。
 * 各表使用对应默认空状态，后续还可显示加载、失败或没有差异等临时状态。
 */
for (const id of [
	'preview',
	'projectOnly',
	'bomOnly',
	'issues',
	'operation',
	'writePreview',
]) {
	tables.set(id, new DataTable(element(id), detail, scrollbars, id === 'preview'
		? emptyStates.fileNone
		: id === 'issues'
			? emptyStates.noIssues
			: id === 'operation'
				? emptyStates.noOperations
				: id === 'writePreview'
					? emptyStates.noWrites
					: emptyStates.noResult));
}

/**
 * 尺寸或可见性变化时更新滚动层和表格布局，隐藏表格自行跳过。
 * 刷新异常进入统一问题入口，不在布局变化时重新读取工程。
 */
function activateTables(): void {
	scrollbars.update();
	void Promise.all([
		...tables.values(),
	].map(table => table.activate())).catch(reportError);
}
/**
 * 映射变化只清除写入计划和预演；位号分隔符变化会影响匹配，因而清除整个核对结果。
 */
const mappingEditor = new MappingEditor(element('mappings'), () => {
	state.plan = undefined;
	void show('writePreview', []);
	updateButtons();
});
const separatorEditor = new SeparatorEditor(element('separators'), element('separatorHint'), element<HTMLButtonElement>('addSeparator'), invalidate);
/**
 * 切页前记录表格滚动位置，离开文件页时提交并清除尚未填写的分隔符草稿。
 */
const tabs = new Tabs(element('tabs'), activateTables, (id) => {
	for (const table of tables.values()) table.suspend();
	if (id === 'panel-file')
		separatorEditor.commit();
});
const resizeObserver = new ResizeObserver(activateTables);
resizeObserver.observe(element('panels'));

/**
 * 向指定表格提交记录和空状态。预览有数据时显示数量说明区域，空数据时清空旧计数。
 */
async function show(id: string, records: Record<string, unknown>[], emptyState?: EmptyState): Promise<void> {
	if (id === 'preview') {
		element('previewState').hidden = !records.length;
		if (!records.length)
			element('previewState').textContent = '';
	}
	await tables.get(id)!.show(records, emptyState);
}

/**
 * 用当前问题集合替换问题表，执行异常由 reportError 追加至相同集合。
 */
async function showIssues(issues: Issue[]): Promise<void> {
	state.issues = issues;
	await show('issues', issues.map(issue => ({ ...issue })));
}

/**
 * 同步设置状态文字与错误样式，文本以 textContent 展示，不执行来源内容。
 */
function status(text: string, error = false): void {
	element('status').textContent = text;
	element('status').classList.toggle('error', error);
}

/**
 * 按传入顺序重建下拉框，提示项使用空值，显示标签与业务定位值分开保存。
 */
function options(target: HTMLSelectElement, entries: { value: string; label: string }[], placeholder?: string): void {
	target.replaceChildren();
	if (placeholder !== undefined)
		target.add(new Option(placeholder, ''));
	for (const entry of entries) target.add(new Option(entry.label, entry.value));
}

/**
 * 统一计算任务锁、有效结果和映射存在性对按钮的影响。
 * 编辑器继续叠加自己的首尾移动、唯一来源和空草稿限制，解除任务锁不会解除这些限制。
 */
function updateButtons(): void {
	for (const button of document.querySelectorAll<HTMLButtonElement>('button[data-result]'))
		button.disabled = state.busy || !state.result;
	for (const control of document.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('[data-config]'))
		control.disabled = state.busy;
	separatorEditor.setBusy(state.busy);
	mappingEditor.setBusy(state.busy);
	element<HTMLButtonElement>('start').disabled = state.busy || !state.file || !select('reference').value;
	element<HTMLButtonElement>('run').disabled = state.busy || !state.result || !mappingEditor.values().length;
}

/**
 * 清除工程结果并异步刷新 BOM 预览，预览异常集中报告，不触发工程修改。
 */
function invalidate(): void {
	invalidateResult();
	void refreshPreview().catch(reportError);
}

/**
 * 清除核对及计划，置空双向差异与写入预演，保留文件、预览、问题和日志。
 * 同步刷新摘要及按钮，使旧快照不能继续用于修改。
 */
function invalidateResult(): void {
	state.result = undefined;
	state.plan = undefined;
	for (const id of ['projectOnly', 'bomOnly', 'writePreview']) void show(id, []);
	element('summary').textContent = state.file ? messages.invalidated : messages.chooseBom;
	updateButtons();
}

/**
 * 同一时间只执行一个受控异步动作，忙碌时的新请求直接返回。
 * 开始前提交分隔符草稿，异常集中报告，finally 始终解除任务锁。
 */
async function task(action: () => Promise<void>): Promise<void> {
	if (state.busy)
		return;
	separatorEditor.commit();
	state.busy = true;
	updateButtons();
	try {
		await action();
	}
	catch (error) {
		reportError(error);
	}
	finally {
		state.busy = false;
		updateButtons();
	}
}

/**
 * 按当前选项读取工作表，索引没有对应解析对象时明确报错。
 */
function selectedSheet(): ParsedSheet {
	const sheet = state.sheets[Number(select('sheet').value)];
	if (!sheet)
		throw new Error(messages.chooseBom);
	return sheet;
}

/**
 * 按稳定 id 查找范围，选择缺失或已过期时拒绝继续。
 */
function selectedScope(): Scope {
	const scope = state.scopes.find(candidate => candidate.id === select('scope').value);
	if (!scope)
		throw new Error(messages.chooseScope);
	return scope;
}

/**
 * 读取工程范围并清空映射，活动文档所属范围优先成为默认值。
 * 没有可处理文档时报告错误，有范围时清除旧核对并提示就绪。
 */
async function refreshScopes(): Promise<void> {
	const data = await host.scopes();
	state.scopes = data.scopes;
	mappingEditor.clear();
	options(select('scope'), data.scopes.map(scope => ({ value: scope.id, label: `${scope.projectName} / ${scope.name}` })));
	const active = data.scopes.find(scope => scope.documents.some(doc => doc.id === data.activeDocument));
	if (active)
		select('scope').value = active.id;
	if (!data.scopes.length)
		throw new Error(messages.noScope);
	invalidate();
	status(messages.ready);
}

/**
 * 根据当前表头行重建列选项并清空映射；自动选择只接受唯一的精确“位号”表头。
 * 保留选择模式重用此前列下标，随后使工程结果失效并更新预览。
 */
async function refreshHeader(resetReference: boolean): Promise<void> {
	mappingEditor.clear();
	const sheet = selectedSheet();
	const headerRow = Number(input('header').value) - 1;
	const columns = sheetColumns(sheet, headerRow);
	const previous = select('reference').value;
	options(select('reference'), columns.map(column => ({
		value: String(column.index),
		label: column.label,
	})), '请选择位号列');
	if (resetReference) {
		const exact = columns.filter(column => column.header === '位号');
		if (exact.length === 1)
			select('reference').value = String(exact[0].index);
		else status(messages.referenceMissing, true);
	}
	else {
		select('reference').value = previous;
	}
	invalidateResult();
	await refreshPreview();
}

/**
 * 把文件、工作表、零开始表头下标、位号列及解析规则传给共享构造器。
 * 预览允许空记录，正式核对要求有可核对位号，两者使用相同清洗逻辑。
 */
function currentBom(allowEmpty = false): BomData {
	if (!state.file || !select('reference').value)
		throw new Error(messages.chooseReference);
	return buildBom(selectedSheet(), state.file.name, Number(input('header').value) - 1, Number(select('reference').value), separatorEditor.values(), input('ignoreCase').checked, allowEmpty);
}
/**
 * 递增序号用于判断最新预览请求，文件切换也推进该序号。
 * 异步显示完成后仅最新且未关闭的请求能够更新预览数量说明。
 */
let previewEpoch = 0;
/**
 * 配置不完整时显示等待状态，有配置时生成有效记录预览并展示清洗问题。
 * 构造失败恢复等待状态后向上传播原因，空有效记录使用明确空状态。
 */
async function refreshPreview(): Promise<void> {
	const epoch = ++previewEpoch;
	if (!state.sheets.length || !select('reference').value) {
		const emptyState = state.file ? emptyStates.previewPending : emptyStates.fileNone;
		await show('preview', [], emptyState);
		return;
	}
	let bom: BomData;
	try {
		bom = currentBom(true);
	}
	catch (error) {
		await show('preview', [], emptyStates.previewPending);
		throw error;
	}
	const records = previewRows(bom);
	await Promise.all([
		show('preview', records, emptyStates.previewEmpty),
		showIssues(bom.issues),
	]);
	if (epoch !== previewEpoch || state.closed)
		return;
	if (records.length)
		element('previewState').textContent = notices.preview(records.length, new Set(bom.records.filter(record => record.valid).map(record => record.row)).size);
}

/**
 * 将内部零开始的最佳候选行转换为界面的一开始行号，无候选时显示第一行供核实。
 */
async function selectSheet(): Promise<void> {
	input('header').value = String((selectedSheet().candidates[0] ?? 0) + 1);
	await refreshHeader(true);
}

/**
 * 清空旧工作表及列选项，显示加载状态后按当前编码重读缓存字节。
 * 优先选择含精确位号表头的工作表，再更新表头和预览；失败时显示文件失败状态。
 */
async function parseFile(): Promise<void> {
	state.sheets = [];
	previewEpoch++;
	invalidateResult();
	options(select('sheet'), []);
	options(select('reference'), [], '请选择位号列');
	await show('preview', [], emptyStates.fileLoading);

	mappingEditor.clear();
	if (!state.bytes || !state.file) {
		await show('preview', [], emptyStates.fileNone);
		return;
	}
	element('filename').textContent = state.file.name;
	try {
		state.sheets = await loadWorkbook(state.bytes, state.file.name, select('encoding').value);
	}
	catch (error) {
		await show('preview', [], emptyStates.fileFailed);

		throw error;
	}
	options(select('sheet'), state.sheets.map((sheet, index) => ({
		value: String(index),
		label: sheet.name,
	})));
	const best = state.sheets.findIndex(sheet => sheet.candidates.some(row => [
		...sheet.rows.get(row)!.values(),
	].some(value => value.trim() === '位号')));
	select('sheet').value = String(Math.max(0, best));
	element('filename').textContent = state.file.name;
	mappingEditor.clear();
	await selectSheet();
	if (select('reference').value)
		status(messages.fileReady);
}

/**
 * 顶部给出统一摘要，问题表追加异常原文，使已有解析证据与执行原因都能查看。
 */
function reportError(error: unknown): void {
	status(messages.failed, true);
	void showIssues([
		...state.issues,
		{
			stage: '执行',
			message: messages.failed,
			detail: errorText(error),
		},
	]);
}

/**
 * 按当前配置构造清单，读取范围全部快照并计算差异，建立真实存在的映射字段目录。
 * 分别展示工程独有、清单独有和问题，摘要区分图元数量与不同位号数量。
 */
async function check(): Promise<void> {
	invalidate();
	if (!state.file || !select('reference').value)
		throw new Error(messages.chooseReference);
	const bom = currentBom();
	const scope = selectedScope();
	const components = await host.readScope(scope, status);
	state.result = compare(bom, components);
	state.fields = targetFields(components);
	mappingEditor.setContext(bom.columns, state.fields);
	await Promise.all([
		show('projectOnly', state.result.projectOnly.map(componentRow), emptyStates.noDifference),
		show('bomOnly', state.result.bomOnly.map(record => bomRow(record, bom)), emptyStates.noDifference),
		showIssues(state.result.issues),
	]);
	element('summary').textContent = notices.checked(components.length, state.result.bomIndex.size, state.result.matchedCount, state.result.projectOnly.length, state.result.bomOnly.length);
	status(messages.checkReady);
}

/**
 * 要求有效核对和至少一个映射组，按当前清空选项重新计算计划，不沿用旧预演值。
 */
function makePlan(): WritePlan {
	if (!state.result)
		throw new Error(messages.noResult);
	if (!mappingEditor.values().length)
		throw new Error(messages.chooseMapping);
	state.plan = planWrites(state.result, mappingEditor.values(), state.fields, input('clearEmpty').checked);
	return state.plan;
}

/**
 * 逐图元逐字段展开前后值与合并证据，显示计划问题和覆盖计数，并返回相同计划供执行。
 */
async function previewWrites(): Promise<WritePlan> {
	const plan = makePlan();
	await show('writePreview', plan.items.flatMap(item => item.changes.map(change => ({
		位号: item.component.designator,
		文档: item.component.documentName,
		字段: change.field.label,
		原值: change.before,
		目标值: change.after,
		合并来源: scalarText(change.sources ?? []),
		合并分隔: change.separator ?? '',
	}))));
	await showIssues(plan.issues);
	status(notices.writes(plan.items.length, plan.overwriteCount, plan.unchangedCount));
	return plan;
}

const progress = (done: number, total: number): void => status(notices.progress(done, total));

/**
 * 静态事件在窗口初始化时绑定一次，耗时操作通过 task 管理。
 * 配置变化分别使整份核对或仅写入预演失效，表格显示顺序不决定工程修改范围。
 */
element('refresh').addEventListener('click', () => void task(refreshScopes));
element('choose').addEventListener('click', () => void task(async () => {
	const file = await filePicker.choose();
	if (!file) {
		status(messages.cancelFile);
		return;
	}
	/**
	 * 实际选中文件后才替换当前 File，取消时保留旧文件和配置。
	 * 读取新字节前清除旧解析与结果，避免继续使用上一个文件的工程快照。
	 */
	state.file = file;
	state.bytes = undefined;
	state.sheets = [];
	previewEpoch++;
	await showIssues([]);
	mappingEditor.clear();
	invalidateResult();
	await show('preview', [], emptyStates.fileLoading);

	element('filename').textContent = file.name;
	try {
		state.bytes = await file.arrayBuffer();
	}
	catch (error) {
		await show('preview', [], emptyStates.fileFailed);

		throw error;
	}
	await parseFile();
}));
select('sheet').addEventListener('change', () => void task(selectSheet));
select('encoding').addEventListener('change', () => void task(parseFile));
input('header').addEventListener('change', () => void task(() => refreshHeader(true)));
select('reference').addEventListener('change', invalidate);
select('scope').addEventListener('change', () => {
	mappingEditor.clear();
	invalidate();
});
input('ignoreCase').addEventListener('change', invalidate);
input('clearEmpty').addEventListener('change', () => {
	state.plan = undefined;
	void show('writePreview', []);
});
element('addSeparator').addEventListener('click', () => separatorEditor.add());
element('resetSeparators').addEventListener('click', () => separatorEditor.reset(DEFAULT_SEPARATORS));
element('start').addEventListener('click', () => void task(check));
element('addMapping').addEventListener('click', () => {
	if (!state.busy && state.result)
		mappingEditor.add();
});
element('previewWritesButton').addEventListener('click', () => void task(async () => {
	await previewWrites();
}));
/**
 * 执行前重新预演并持久保存修改前计划，存储失败时不调用写入。
 * 完成后展示日志、使差异失效，并按成功、跳过、取消和失败结果汇总。
 */
element('run').addEventListener('click', () => void task(async () => {
	const scope = selectedScope();
	const plan = await previewWrites();
	await host.storeRecovery({
		scope,
		plan,
		createdAt: new Date().toISOString(),
	});
	state.operation = await executeWrites(host, scope, plan, async (issues: Issue[]) => {
		await showIssues(issues);
		status(notices.issues(issues.length));
	}, progress);
	await show('operation', state.operation.map(row => ({ ...row })));
	invalidateResult();
	const counts = state.operation.reduce<Record<string, number>>((summary, row) => {
		summary[row.结果] = (summary[row.结果] ?? 0) + 1;
		return summary;
	}, {});
	status(notices.finished('属性写入', counts.成功 ?? 0, (counts.跳过 ?? 0) + (counts.已取消 ?? 0), (counts.失败 ?? 0) + (counts.保存失败 ?? 0)));
}));
/**
 * 删除前保存范围和完整候选，服务层再排除歧义对象并请求一次确认。
 * 操作后清除旧核对，下次修改工程必须重新读取快照。
 */
element('delete').addEventListener('click', () => void task(async () => {
	if (!state.result)
		throw new Error(messages.noResult);
	await host.storeRecovery({
		scope: selectedScope(),
		deletedCandidates: state.result.projectOnly,
		createdAt: new Date().toISOString(),
	});
	state.operation = await executeDelete(host, selectedScope(), state.result, progress);
	await show('operation', state.operation.map(row => ({ ...row })));
	invalidateResult();
	status(notices.finished('器件删除', state.operation.filter(row => row.结果 === '删除成功').length, state.operation.filter(row => row.结果 === '已取消').length, state.operation.filter(row => row.结果 === '删除失败' || row.结果 === '保存失败').length));
}));
/**
 * 差异表使用与界面相同的记录转换，生成 Excel 后交宿主保存，建议文件名包含当前时间。
 */
element('export').addEventListener('click', () => void task(async () => {
	if (!state.result)
		throw new Error(messages.noResult);
	const result = state.result;
	const bytes = exportTables(result.projectOnly.map(componentRow), result.bomOnly.map(record => bomRow(record, result.bom)));
	await host.saveFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${extensionInfo.displayName}_差异_${Date.now()}.xlsx`);
	status(messages.exportSaved);
}));
/**
 * 集中身份、原值记录和当前结果共同组成 UTF-8 JSON 日志，只保存数据，不执行原值回写。
 */
element('exportRecord').addEventListener('click', () => void task(async () => {
	const recovery = host.recovery();
	await host.saveFile(new Blob([
		JSON.stringify(operationLog(recovery, state.operation), null, 2),
	], { type: 'application/json;charset=utf-8' }), `${extensionInfo.displayName}_操作记录_${Date.now()}.json`);
	status(messages.logSaved);
}));
element('closeDetail').addEventListener('click', () => element<HTMLDialogElement>('detail').close());
/**
 * 关闭时取消文件选择，释放表格、编辑器监听、覆盖滚动层和尺寸观察器。
 * 清空文件字节及快照引用，关闭标记阻止过期预览继续更新数量说明。
 */
window.addEventListener('beforeunload', () => {
	state.closed = true;
	filePicker.dispose();
	state.bytes = undefined;
	state.sheets = [];
	state.result = undefined;
	tables.forEach(table => table.destroy());
	tables.clear();
	tabs.dispose();
	separatorEditor.dispose();
	mappingEditor.dispose();
	scrollbars.dispose();
	resizeObserver.disconnect();
});
separatorEditor.reset(DEFAULT_SEPARATORS);
input('ignoreCase').checked = DEFAULT_IGNORE_CASE;
document.title = extensionInfo.displayName;
void task(refreshScopes);
