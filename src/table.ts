import type { EmptyState } from './messages';
import type { Scrollbars } from './scrollbars';
import { TabulatorFull } from 'tabulator-tables';
import { emptyStates } from './messages';
import { scalarText } from './rules';

/** 隐藏面板只保存数据，表格在可见时创建，标签切换保留列和交互状态。 */
export class DataTable {
	private table?: TabulatorFull;
	private records: Record<string, unknown>[] = [];
	private dirty = true;
	private disposed = false;
	private position?: { left: number; top: number };
	private queue = Promise.resolve();
	private readonly placeholder = document.createElement('div');

	constructor(private readonly element: HTMLElement, private readonly onDetail: (record: Record<string, unknown>) => void, private readonly scrollbars: Scrollbars, private readonly emptyState: EmptyState = emptyStates.noResult) {
		this.updatePlaceholder(emptyState);
	}

	/** 自有节点承载可访问的状态结构，不依赖表格库为字符串生成的内部类名。 */
	private updatePlaceholder(state: EmptyState, target = this.placeholder): HTMLElement {
		target.className = 'table-empty-state';
		target.dataset.kind = state.kind;
		target.setAttribute('role', 'status');
		target.setAttribute('aria-live', 'polite');
		const title = document.createElement('p');
		title.className = 'table-empty-title';
		title.textContent = state.title;
		const description = document.createElement('p');
		description.className = 'table-empty-description';
		description.textContent = state.description;
		target.replaceChildren(title, description);
		return target;
	}

	async show(records: Record<string, unknown>[], emptyState = this.emptyState): Promise<void> {
		this.updatePlaceholder(emptyState);
		this.records = records;
		this.position = undefined;
		this.dirty = true;
		await this.activate();
	}

	/** 可见后串行刷新，重绘保留滚动位置，隐藏时不创建表格或等待构建事件。 */
	activate(): Promise<void> {
		const work = this.queue.then(async () => {
			if (this.disposed || !this.element.getClientRects().length || !this.element.offsetWidth || !this.element.offsetHeight)
				return;
			if (!this.table) {
				this.element.classList.toggle('empty-table', !this.records.length);
				this.table = new TabulatorFull(this.element, {
					layout: 'fitData',
					autoResize: false,
					placeholder: this.placeholder,
					placeholderHeaderFilter: this.updatePlaceholder(emptyStates.filteredEmpty, document.createElement('div')),
					columns: [],
				});
				await new Promise<void>(resolve => this.table!.on('tableBuilt', resolve));
				if (this.disposed)
					return;
				this.table.on('rowDblClick', (_event, row) => this.onDetail(row.getData().original));
				this.scrollbars.attach(this.element.querySelector<HTMLElement>('.tabulator-tableholder')!);
			}
			if (this.dirty) {
				const records = this.records;
				const keys = [
					...new Set(records.flatMap(record => Object.keys(record))),
				];
				this.element.classList.toggle('empty-table', !records.length);
				this.table.setColumns(keys.map((key, index) => ({
					title: key,
					field: `f${index}`,
					formatter: 'plaintext',
					titleFormatter: 'plaintext',
					headerFilter: 'input',
					maxWidth: 420,
					minWidth: 130,
					tooltip: true,
				})));
				await this.table.setData(records.map(record => ({
					original: record,
					...Object.fromEntries(keys.map((key, index) => [
						`f${index}`,
						scalarText(record[key]),
					])),
				})));
				this.dirty = this.records !== records;
			}
			const holder = this.element.querySelector('.tabulator-tableholder');
			const top = this.position?.top ?? holder?.scrollTop ?? 0;
			const left = this.position?.left ?? holder?.scrollLeft ?? 0;
			this.position = undefined;
			this.table.redraw();
			holder?.scrollTo(left, top);
			this.scrollbars.update();
		});
		// 原始任务向调用方报告异常，队列允许后续独立操作继续运行。
		this.queue = work.catch(() => undefined);
		return work;
	}

	/** 显示状态变化前记录视口位置，浏览器隐藏节点的尺寸不会覆盖该记录。 */
	suspend(): void {
		const holder = this.element.querySelector('.tabulator-tableholder');
		if (holder && this.element.getClientRects().length)
			this.position = { left: holder.scrollLeft, top: holder.scrollTop };
	}

	destroy(): void {
		this.disposed = true;
		const holder = this.element.querySelector<HTMLElement>('.tabulator-tableholder');
		if (holder)
			this.scrollbars.detach(holder);
		this.table?.destroy();
		this.records = [];
	}
}
