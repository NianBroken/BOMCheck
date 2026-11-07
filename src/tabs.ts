/**
 * 实现标签的点击和键盘导航，切页复用原面板 DOM 和业务状态。
 * 面板自身滚动位置由本类保存，表格内部滚动由离开回调交给表格包装保存。
 */
/** 标签页只管理显示与焦点，面板DOM和业务状态在切换过程中保持原样。 */
export class Tabs {
	/**
	 * 按导航 DOM 顺序保存标签，左右循环和首尾跳转均依照该顺序。
	 */
	private readonly buttons: HTMLButtonElement[];
	/**
	 * 统一管理全部标签事件监听，销毁时通过 abort 一次解除。
	 */
	private readonly subscriptions = new AbortController();
	/**
	 * 按面板 id 保存离开时的纵向位置，不包含表格内部视口。
	 */
	private readonly positions = new Map<string, number>();

	/**
	 * 收集 tab 按钮并绑定点击、左右方向键、Home 和 End。
	 * 识别到支持的按键时阻止默认行为，移动焦点并激活目标标签。
	 */
	constructor(root: HTMLElement, private readonly onActivate: () => void, private readonly onLeave: (id: string) => void = () => {}) {
		this.buttons = [
			...root.querySelectorAll<HTMLButtonElement>('[role=tab]'),
		];
		for (const button of this.buttons) {
			button.addEventListener('click', () => this.activate(button), { signal: this.subscriptions.signal });
			button.addEventListener('keydown', (event) => {
				const index = this.buttons.indexOf(button);
				const target = event.key === 'ArrowRight'
					? (index + 1) % this.buttons.length
					: event.key === 'ArrowLeft'
						? (index + this.buttons.length - 1) % this.buttons.length
						: event.key === 'Home'
							? 0
							: event.key === 'End'
								? this.buttons.length - 1
								: -1;
				if (target < 0)
					return;
				event.preventDefault();
				this.buttons[target].focus();
				this.activate(this.buttons[target]);
			}, { signal: this.subscriptions.signal });
		}
	}

	/**
	 * 当前标签重复选择直接返回。切换前调用离开回调，随后保存旧面板位置。
	 * 更新选中属性、键盘焦点顺序和面板隐藏状态，恢复目标位置后通知布局更新。
	 */
	private activate(selected: HTMLButtonElement): void {
		if (selected.getAttribute('aria-selected') === 'true')
			return;
		const current = this.buttons.find(button => button.getAttribute('aria-selected') === 'true');
		if (current)
			this.onLeave(current.getAttribute('aria-controls')!);
		for (const button of this.buttons) {
			const id = button.getAttribute('aria-controls')!;
			const panel = document.getElementById(id)!;
			if (button.getAttribute('aria-selected') === 'true')
				this.positions.set(id, panel.scrollTop);
			const active = button === selected;
			button.setAttribute('aria-selected', String(active));
			button.tabIndex = active
				? 0
				: -1;
			panel.hidden = !active;
			if (active)
				panel.scrollTop = this.positions.get(id) ?? 0;
		}
		this.onActivate();
	}

	/**
	 * 中止监听并清空面板位置记录，实例不再处理导航。
	 */
	dispose(): void {
		this.subscriptions.abort();
		this.positions.clear();
	}
}
