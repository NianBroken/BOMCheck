/** 标签页只管理显示与焦点，面板DOM和业务状态在切换过程中保持原样。 */
export class Tabs {
	private readonly buttons: HTMLButtonElement[];
	private readonly subscriptions = new AbortController();
	private readonly positions = new Map<string, number>();

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

	/** 每个面板分别保存滚动位置，重选当前标签不触发重新布局。 */
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

	dispose(): void {
		this.subscriptions.abort();
		this.positions.clear();
	}
}
