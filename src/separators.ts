/**
 * 管理完整字面位号分隔符，分别维护输入草稿、有效解析集合和状态提示。
 * 事件在容器上委托，有效集合变化才报告核对失效，空行及重复项另外统计。
 */
import commands from '../ui/commands.json';
import { notices } from './messages';
import { effectiveSeparators } from './rules';

/**
 * 输入行的稳定序号定位对应控件，value 保留完整字面内容。
 */
interface SeparatorRow {
	id: number;
	value: string;
}

/** 每行保存一个完整字面分隔符，界面与解析共享同一有效值计算规则。 */
export class SeparatorEditor {
	private rows: SeparatorRow[] = [];
	private serial = 0;
	/**
	 * 上次有效集合的 JSON 表示，忽略不影响实际解析的空草稿与重复项变化。
	 */
	private signature = '[]';
	private busy = false;
	private readonly subscriptions = new AbortController();

	/**
	 * 监听输入和移除操作，焦点离开后用微任务确认是否真正离开整个编辑区。
	 * 在区域内切换按钮不提前提交草稿，离开区域则移除未填的完全空行。
	 */
	constructor(private readonly container: HTMLElement, private readonly hint: HTMLElement, private readonly addButton: HTMLButtonElement, private readonly onChange: () => void) {
		const field = container.closest('.separator-field')!;
		field.addEventListener('focusout', () => {
			queueMicrotask(() => {
				if (!field.contains(document.activeElement))
					this.commit();
			});
		}, { signal: this.subscriptions.signal });
		container.addEventListener('input', (event) => {
			const control = event.target;
			if (!(control instanceof HTMLInputElement))
				return;
			const row = this.rows.find(entry => entry.id === Number(control.dataset.row));
			if (row) {
				row.value = control.value;
				this.synchronize();
			}
		}, { signal: this.subscriptions.signal });
		container.addEventListener('click', (event) => {
			const control = event.target;
			if (!(control instanceof HTMLButtonElement))
				return;
			const id = Number(control.dataset.row);
			this.rows = this.rows.filter(row => row.id !== id);
			control.closest('.separator-row')!.remove();
			this.synchronize();
		}, { signal: this.subscriptions.signal });
	}

	/**
	 * 调用共享规则去除空文本、按完整值去重并按长度排序，返回实际解析集合。
	 */
	values(): string[] {
		return effectiveSeparators(this.rows.map(row => row.value));
	}

	/**
	 * 统计有效项、空行和重复项，更新提示及添加按钮。
	 * 仅有效集合签名变化才通知业务，重复相同分隔符不会重新解释位号。
	 */
	private synchronize(): void {
		const values = this.values();
		const empty = this.rows.filter(row => row.value === '').length;
		const duplicates = this.rows.length - empty - values.length;
		this.hint.textContent = notices.separator(values.length, empty, duplicates);
		this.addButton.disabled = this.busy || empty > 0;
		const signature = JSON.stringify(values);
		if (signature !== this.signature) {
			this.signature = signature;
			this.onChange();
		}
	}

	/**
	 * 创建普通文本输入和移除按钮，data-row 关联模型标识，多字符作为一个整体保存。
	 */
	private append(value: string): HTMLInputElement {
		const row = { id: ++this.serial, value };
		this.rows.push(row);
		const wrapper = document.createElement('div');
		wrapper.className = 'separator-row';
		const control = document.createElement('input');
		control.type = 'text';
		control.value = value;
		control.dataset.row = String(row.id);
		control.dataset.config = '';
		control.setAttribute('aria-label', '字面分隔符');
		control.placeholder = '输入一个分隔符，可包含多个字符';
		const remove = document.createElement('button');
		remove.type = 'button';
		remove.textContent = commands.removeSeparator;
		remove.dataset.row = String(row.id);
		remove.dataset.config = '';
		wrapper.append(control, remove);
		this.container.append(wrapper);
		return control;
	}

	/**
	 * 忙碌时不处理，存在空行时聚焦该行，否则建立空草稿供填写。
	 */
	add(): void {
		if (this.busy)
			return;
		const empty = this.rows.find(row => row.value === '');
		if (empty) {
			this.container.querySelector<HTMLInputElement>(`input[data-row="${empty.id}"]`)!.focus();
			return;
		}
		this.append('').focus();
		this.synchronize();
	}

	/**
	 * 按非空输入重建全部草稿行，然后重新计算去重后的实际集合。
	 */
	reset(values: string[]): void {
		this.rows = [];
		this.container.replaceChildren();
		values.filter(value => value !== '').forEach(value => this.append(value));
		this.synchronize();
	}

	/**
	 * 移除值完全为空字符串的模型行和节点；普通空格保留为有意义的字面分隔符。
	 */
	commit(): void {
		for (const row of this.rows.filter(row => row.value === ''))
			this.container.querySelector(`input[data-row="${row.id}"]`)!.closest('.separator-row')!.remove();
		this.rows = this.rows.filter(row => row.value !== '');
		this.synchronize();
	}

	/**
	 * 保存任务锁并限制添加入口，其余 data-config 控件由页面统一禁用。
	 */
	setBusy(busy: boolean): void {
		this.busy = busy;
		this.addButton.disabled = busy || this.rows.some(row => row.value === '');
	}

	/**
	 * 解除委托事件，移除输入节点并清空草稿数组。
	 */
	dispose(): void {
		this.subscriptions.abort();
		this.rows = [];
		this.container.replaceChildren();
	}
}
