/**
 * 管理表格库的按需构建、串行刷新、空状态和完整记录详情。
 * 业务字段与库内部显示字段分开保存，切页和重绘尽量保留原有交互状态。
 */
import type { EmptyState } from './messages';
import type { Scrollbars } from './scrollbars';
import { TabulatorFull } from 'tabulator-tables';
import { emptyStates } from './messages';
import { scalarText } from './rules';

/** 隐藏面板只保存数据，表格在可见时创建，标签切换保留列和交互状态。 */
export class DataTable {
	/**
	 * 按需建立的真实表格实例，未显示面板只缓存业务记录。
	 */
	private table?: TabulatorFull;
	/**
	 * 最近一次提交的业务记录数组；异步 setData 完成后以引用比较判断期间是否收到另一批数据。
	 */
	private records: Record<string, unknown>[] = [];
	/**
	 * 标记列和数据需要重建，单纯可见性或尺寸变化不设置此标记。
	 */
	private dirty = true;
	/**
	 * 销毁后排队任务直接返回，不再创建表格。
	 */
	private disposed = false;
	/**
	 * 切页前暂存的滚动坐标，可见重绘后恢复。
	 */
	private position?: { left: number; top: number };
	/**
	 * 串行连接构建、数据替换和重绘，避免并发访问同一表格实例。
	 */
	private queue = Promise.resolve();
	/**
	 * 自有空状态节点，可更新标题、说明和类别，文本通过 textContent 写入，不解释为 HTML。
	 */
	private readonly placeholder = document.createElement('div');

	/**
	 * 保存容器、详情回调、滚动管理器和默认空状态，在真正建表前准备提示节点。
	 */
	constructor(private readonly element: HTMLElement, private readonly onDetail: (record: Record<string, unknown>) => void, private readonly scrollbars: Scrollbars, private readonly emptyState: EmptyState = emptyStates.noResult) {
		this.updatePlaceholder(emptyState);
	}

	/**
	 * 用文本节点设置状态标题和说明，同时声明实时状态语义。
	 * 既可更新表级空提示，也可为筛选无结果建立独立提示节点。
	 */
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

	/**
	 * 替换缓存和提示，清除上批滚动坐标并标记脏数据，再进入可见性检查。
	 */
	async show(records: Record<string, unknown>[], emptyState = this.emptyState): Promise<void> {
		this.updatePlaceholder(emptyState);
		this.records = records;
		this.position = undefined;
		this.dirty = true;
		await this.activate();
	}

	/**
	 * 按队列执行刷新，隐藏、零尺寸或已销毁的容器直接返回。
	 * 首次创建等待 tableBuilt，再绑定行详情和滚动区域；数据脏时才重建列与显示行。
	 * 当前任务异常交调用方处理，内部队列恢复可继续接收下一次刷新。
	 */
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
				/**
				 * 按首次出现顺序形成完整字段并集，库内部使用 f 加序号作为 field。
				 * 这样业务属性中的点号等字符不会被当作嵌套对象路径。
				 */
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
				/**
				 * 显示值统一转成文本，完整原记录保存在 original。
				 * 数据替换期间若 records 引用变化，dirty 保持为真；后续排队的刷新会用新引用再次建立列和数据。
				 */
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

	/**
	 * 仅在容器可见时记录真实视口位置，隐藏节点的零尺寸不会覆盖暂存值。
	 */
	suspend(): void {
		const holder = this.element.querySelector('.tabulator-tableholder');
		if (holder && this.element.getClientRects().length)
			this.position = { left: holder.scrollLeft, top: holder.scrollTop };
	}

	/**
	 * 标记销毁后解除视口滚动层、销毁表格并释放缓存记录。
	 */
	destroy(): void {
		this.disposed = true;
		const holder = this.element.querySelector<HTMLElement>('.tabulator-tableholder');
		if (holder)
			this.scrollbars.detach(holder);
		this.table?.destroy();
		this.records = [];
	}
}
