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

function element<T extends HTMLElement>(id: string): T {
	const target = document.getElementById(id);
	if (!target)
		throw new Error(`界面控件不存在：${id}`);
	return target as T;
}
const select = (id: string): HTMLSelectElement => element<HTMLSelectElement>(id);
const input = (id: string): HTMLInputElement => element<HTMLInputElement>(id);
const tables = new Map<string, DataTable>();
const scrollbars = new Scrollbars();
for (const panel of document.querySelectorAll<HTMLElement>('[role=tabpanel]')) scrollbars.attach(panel);
scrollbars.attach(element('detailScroll'));

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

/** 页面可见性变化只刷新布局，不重读工程或重建已有列。 */
function activateTables(): void {
	scrollbars.update();
	void Promise.all([
		...tables.values(),
	].map(table => table.activate())).catch(reportError);
}
const mappingEditor = new MappingEditor(element('mappings'), () => {
	state.plan = undefined;
	void show('writePreview', []);
	updateButtons();
});
const separatorEditor = new SeparatorEditor(element('separators'), element('separatorHint'), element<HTMLButtonElement>('addSeparator'), invalidate);
const tabs = new Tabs(element('tabs'), activateTables, (id) => {
	for (const table of tables.values()) table.suspend();
	if (id === 'panel-file')
		separatorEditor.commit();
});
const resizeObserver = new ResizeObserver(activateTables);
resizeObserver.observe(element('panels'));

async function show(id: string, records: Record<string, unknown>[], emptyState?: EmptyState): Promise<void> {
	if (id === 'preview') {
		element('previewState').hidden = !records.length;
		if (!records.length)
			element('previewState').textContent = '';
	}
	await tables.get(id)!.show(records, emptyState);
}

/** 问题清单只展示当前文件与批次，执行异常保留在同一份证据集合中。 */
async function showIssues(issues: Issue[]): Promise<void> {
	state.issues = issues;
	await show('issues', issues.map(issue => ({ ...issue })));
}

function status(text: string, error = false): void {
	element('status').textContent = text;
	element('status').classList.toggle('error', error);
}

function options(target: HTMLSelectElement, entries: { value: string; label: string }[], placeholder?: string): void {
	target.replaceChildren();
	if (placeholder !== undefined)
		target.add(new Option(placeholder, ''));
	for (const entry of entries) target.add(new Option(entry.label, entry.value));
}

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

/** 失效处理保留BOM预览，工程差异和写入预览只展示当前配置产生的结果。 */
function invalidate(): void {
	invalidateResult();
	void refreshPreview().catch(reportError);
}

/** 批次结束时保留问题和操作记录，器件差异必须重新检查。 */
function invalidateResult(): void {
	state.result = undefined;
	state.plan = undefined;
	for (const id of ['projectOnly', 'bomOnly', 'writePreview']) void show(id, []);
	element('summary').textContent = state.file ? messages.invalidated : messages.chooseBom;
	updateButtons();
}

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

function selectedSheet(): ParsedSheet {
	const sheet = state.sheets[Number(select('sheet').value)];
	if (!sheet)
		throw new Error(messages.chooseBom);
	return sheet;
}

function selectedScope(): Scope {
	const scope = state.scopes.find(candidate => candidate.id === select('scope').value);
	if (!scope)
		throw new Error(messages.chooseScope);
	return scope;
}

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

/** 预览显示实际行号，表头与位号列始终可以手动校正。 */
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

/** 预览与核对采用相同的位号展开和清洗规则，预览空结果不触发工程操作。 */
function currentBom(allowEmpty = false): BomData {
	if (!state.file || !select('reference').value)
		throw new Error(messages.chooseReference);
	return buildBom(selectedSheet(), state.file.name, Number(input('header').value) - 1, Number(select('reference').value), separatorEditor.values(), input('ignoreCase').checked, allowEmpty);
}
let previewEpoch = 0;
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

async function selectSheet(): Promise<void> {
	input('header').value = String((selectedSheet().candidates[0] ?? 0) + 1);
	await refreshHeader(true);
}

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

/** 异常摘要保持简短，原始原因作为完整问题证据保存。 */
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

function makePlan(): WritePlan {
	if (!state.result)
		throw new Error(messages.noResult);
	if (!mappingEditor.values().length)
		throw new Error(messages.chooseMapping);
	state.plan = planWrites(state.result, mappingEditor.values(), state.fields, input('clearEmpty').checked);
	return state.plan;
}

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

/** 所有事件使用同一个任务入口，异常在状态区域和结果列表中明确显示。 */
element('refresh').addEventListener('click', () => void task(refreshScopes));
element('choose').addEventListener('click', () => void task(async () => {
	const file = await filePicker.choose();
	if (!file) {
		status(messages.cancelFile);
		return;
	}
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
element('export').addEventListener('click', () => void task(async () => {
	if (!state.result)
		throw new Error(messages.noResult);
	const result = state.result;
	const bytes = exportTables(result.projectOnly.map(componentRow), result.bomOnly.map(record => bomRow(record, result.bom)));
	await host.saveFile(new Blob([bytes], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), `${extensionInfo.displayName}_差异_${Date.now()}.xlsx`);
	status(messages.exportSaved);
}));
element('exportRecord').addEventListener('click', () => void task(async () => {
	const recovery = host.recovery();
	await host.saveFile(new Blob([
		JSON.stringify(operationLog(recovery, state.operation), null, 2),
	], { type: 'application/json;charset=utf-8' }), `${extensionInfo.displayName}_操作记录_${Date.now()}.json`);
	status(messages.logSaved);
}));
element('closeDetail').addEventListener('click', () => element<HTMLDialogElement>('detail').close());
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
