/**
 * 用独立组模型管理目标字段与有序来源，DOM 负责呈现模型和收集编辑操作。
 * 结构编辑统一重绘，分隔符输入保留草稿并即时校验，模型副本供业务计划读取。
 */
import type { BomColumn, Mapping, TargetField } from './model';
import commands from '../ui/commands.json';
import { messages } from './messages';
import { mappingSeparator, validJoinSeparator } from './rules';

/** 映射数据独立于DOM保存；界面顺序只呈现有序来源，不承担业务配置存储。 */
export class MappingEditor {
	/**
	 * 所有映射组的当前模型，sources 数组顺序就是文本拼接顺序。
	 */
	private groups: Mapping[] = [];
	private columns: BomColumn[] = [];
	private fields: TargetField[] = [];
	/**
	 * 映射组和来源共用递增标识，移除后不复用序号。
	 */
	private serial = 0;
	private busy = false;

	/**
	 * 注入容器与变化回调，业务层据此清除过期写入预演。
	 */
	constructor(private readonly container: HTMLElement, private readonly changed: () => void) {}

	/**
	 * 返回深复制，业务计算不直接持有编辑器继续修改的数组。
	 */
	values(): Mapping[] {
		return structuredClone(this.groups);
	}

	/**
	 * 设置可用来源列和目标目录并重绘，是否清空组由调用方在上下文变化时决定。
	 */
	setContext(columns: BomColumn[], fields: TargetField[]): void {
		this.columns = columns;
		this.fields = fields;
		this.render();
	}

	/**
	 * 移除全部组和控件，暂存的列目录、目标目录及序号继续保留。
	 */
	clear(): void {
		this.groups = [];
		this.container.replaceChildren();
	}

	/**
	 * 空闲时建立未选目标且仅含一条未选来源的组，默认分隔符为空，重绘后报告变化。
	 */
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

	/**
	 * 任务锁和控件自身 unavailable 共同决定禁用，解锁不放开首尾移动及唯一来源限制。
	 */
	setBusy(busy: boolean): void {
		this.busy = busy;
		for (const control of this.container.querySelectorAll<HTMLButtonElement | HTMLSelectElement | HTMLTextAreaElement>('button,select,textarea'))
			control.disabled = busy || control.dataset.unavailable === 'true';
	}

	/**
	 * 结构操作先检查任务锁，再修改模型、重绘和通知调用方。
	 */
	private update(action: () => void): void {
		if (this.busy)
			return;
		action();
		this.render();
		this.changed();
	}

	/**
	 * 命令字典提供文字，data-action 表示动作，点击时再次检查 disabled 后才更新。
	 */
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

	/**
	 * 选项使用稳定 id，已被其他目标或来源占用的项禁用，但当前选中值可以保留。
	 * 重名及空表头列仍按列位置识别，不根据显示文字合并。
	 */
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

	/**
	 * 从组模型建立目标、来源行、移动和移除控件。
	 * 多个来源才显示分隔草稿，单来源保留但不使用其隐藏草稿，最后统一恢复任务锁。
	 */
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
				/**
				 * 交换当前来源与相邻项，首尾按钮限制偏移有效，操作后重绘使闭包下标对应当前顺序。
				 */
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
				/**
				 * 共用业务分隔符规则，更新控件原生有效性、可访问错误标记及可见提示。
				 * 保留用户完整输入，不删除非法字符以掩盖原输入。
				 */
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

	/**
	 * 清空控件、映射和列字段引用，释放与当前工程相关的数据。
	 */
	dispose(): void {
		this.clear();
		this.columns = [];
		this.fields = [];
	}
}
