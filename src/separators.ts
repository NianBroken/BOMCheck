import commands from '../ui/commands.json';
import { notices } from './messages';
import { effectiveSeparators } from './rules';

interface SeparatorRow {
	id: number;
	value: string;
}

/** 每行保存一个完整字面分隔符，界面与解析共享同一有效值计算规则。 */
export class SeparatorEditor {
	private rows: SeparatorRow[] = [];
	private serial = 0;
	private signature = '[]';
	private busy = false;
	private readonly subscriptions = new AbortController();

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

	values(): string[] {
		return effectiveSeparators(this.rows.map(row => row.value));
	}

	/** 空行和重复行影响编辑提示，有效集合变化才使已有核对结果失效。 */
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

	reset(values: string[]): void {
		this.rows = [];
		this.container.replaceChildren();
		values.filter(value => value !== '').forEach(value => this.append(value));
		this.synchronize();
	}

	/** 空行只属于正在编辑的草稿，离开编辑流程时不保留在行状态中。 */
	commit(): void {
		for (const row of this.rows.filter(row => row.value === ''))
			this.container.querySelector(`input[data-row="${row.id}"]`)!.closest('.separator-row')!.remove();
		this.rows = this.rows.filter(row => row.value !== '');
		this.synchronize();
	}

	setBusy(busy: boolean): void {
		this.busy = busy;
		this.addButton.disabled = busy || this.rows.some(row => row.value === '');
	}

	dispose(): void {
		this.subscriptions.abort();
		this.rows = [];
		this.container.replaceChildren();
	}
}
