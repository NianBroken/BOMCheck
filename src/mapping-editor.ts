import type { BomColumn, Mapping, TargetField } from './model';
import commands from '../ui/commands.json';
import { messages } from './messages';
import { mappingSeparator, validJoinSeparator } from './rules';

/** 映射数据独立于DOM保存；界面顺序只呈现有序来源，不承担业务配置存储。 */
export class MappingEditor {
	private groups: Mapping[] = [];
	private columns: BomColumn[] = [];
	private fields: TargetField[] = [];
	private serial = 0;
	private busy = false;

	constructor(private readonly container: HTMLElement, private readonly changed: () => void) {}

	values(): Mapping[] {
		return structuredClone(this.groups);
	}

	setContext(columns: BomColumn[], fields: TargetField[]): void {
		this.columns = columns;
		this.fields = fields;
		this.render();
	}

	clear(): void {
		this.groups = [];
		this.container.replaceChildren();
	}

	add(): void {
		if (this.busy)
			return;
		this.groups.push({
			id: String(++this.serial),
			fieldId: '',
			sources: [
				{
					id: String(++this.serial),
					columnId: '',
				},
			],
			separator: '',
		});
		this.render();
		this.changed();
	}

	/** 控件状态由同一入口计算，批量锁不能覆盖首尾移动和来源数量的限制。 */
	setBusy(busy: boolean): void {
		this.busy = busy;
		for (const control of this.container.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button,select,textarea'))
			control.disabled = busy || control.dataset.unavailable === 'true';
	}

	private update(action: () => void): void {
		if (this.busy)
			return;
		action();
		this.render();
		this.changed();
	}

	private button(key: keyof typeof commands, action: () => void, unavailable = false): HTMLButtonElement {
		const button = document.createElement('button');
		button.type = 'button';
		button.textContent = commands[key];
		button.dataset.config = '';
		button.dataset.action = key;
		button.dataset.unavailable = String(unavailable);
		button.addEventListener('click', () => {
			if (!button.disabled)
				this.update(action);
		});
		return button;
	}

	/** 选项保留列位置标识，重名列与空表头始终是不同来源。 */
	private select(label: string, entries: { id: string; label: string }[], value: string, taken: Set<string>, changed: (value: string) => void): HTMLSelectElement {
		const select = document.createElement('select');
		select.setAttribute('aria-label', label);
		select.dataset.config = '';
		select.add(new Option(label, ''));
		for (const entry of entries) {
			const option = new Option(entry.label, entry.id);
			option.disabled = taken.has(entry.id) && entry.id !== value;
			select.add(option);
		}
		select.value = value;
		select.addEventListener('change', () => this.update(() => changed(select.value)));
		return select;
	}

	private render(): void {
		this.container.replaceChildren();
		for (const group of this.groups) {
			const panel = document.createElement('div');
			panel.className = 'mapping';
			panel.dataset.group = group.id;
			const targetLabel = document.createElement('label');
			targetLabel.className = 'field';
			targetLabel.textContent = '目标属性';
			targetLabel.append(this.select('选择目标属性', this.fields, group.fieldId, new Set(this.groups.map(g => g.fieldId)), (value) => {
				group.fieldId = value;
			}));
			const controls = document.createElement('div');
			controls.className = 'line';
			controls.append(this.button('addSource', () => group.sources.push({
				id: String(++this.serial),
				columnId: '',
			})), this.button('removeMapping', () => {
				this.groups = this.groups.filter(g => g.id !== group.id);
			}));
			panel.append(targetLabel, controls);
			const sources = document.createElement('div');
			sources.className = 'mapping-sources';
			group.sources.forEach((source, index) => {
				const row = document.createElement('div');
				row.className = 'mapping-source';
				row.dataset.source = source.id;
				const number = document.createElement('span');
				number.textContent = String(index + 1);
				const select = this.select('选择来源列', this.columns, source.columnId, new Set(group.sources.map(s => s.columnId)), (value) => {
					source.columnId = value;
				});
				const move = (offset: number): void => {
					[group.sources[index], group.sources[index + offset]] = [group.sources[index + offset], group.sources[index]];
				};
				const actions = document.createElement('div');
				actions.className = 'source-actions';
				actions.append(this.button('moveUp', () => move(-1), index === 0), this.button('moveDown', () => move(1), index === group.sources.length - 1), this.button('removeSource', () => {
					group.sources = group.sources.filter(s => s.id !== source.id);
				}, group.sources.length === 1));
				row.append(number, select, actions);
				sources.append(row);
			});
			panel.append(sources);
			if (group.sources.length > 1) {
				const separatorLabel = document.createElement('label');
				separatorLabel.className = 'field';
				separatorLabel.textContent = '合并分隔符，留空直接拼接';
				// 文本区域保留换行与粘贴原值，使非法输入能够明确报错而不是被控件静默删除。
				const separator = document.createElement('textarea');
				separator.rows = 1;
				separator.value = group.separator;
				separator.dataset.config = '';
				separator.setAttribute('aria-label', '合并分隔符');
				const warning = document.createElement('p');
				warning.className = 'field-state error';
				warning.setAttribute('role', 'status');
				const validate = (): void => {
					const valid = validJoinSeparator(mappingSeparator(group));
					separator.setCustomValidity(valid ? '' : messages.separatorInvalid);
					separator.setAttribute('aria-invalid', String(!valid));
					warning.textContent = valid ? '' : messages.separatorInvalid;
					warning.hidden = valid;
				};
				separator.addEventListener('input', () => {
					group.separator = separator.value;
					validate();
					this.changed();
				});
				validate();
				separatorLabel.append(separator);
				panel.append(separatorLabel, warning);
			}
			this.container.append(panel);
		}
		this.setBusy(this.busy);
	}

	dispose(): void {
		this.clear();
		this.columns = [];
		this.fields = [];
	}
}
