import type { OverlayScrollbars as ScrollInstance } from 'overlayscrollbars';
import { ClickScrollPlugin, OverlayScrollbars } from 'overlayscrollbars';

OverlayScrollbars.plugin(ClickScrollPlugin);

/** 所有滚动区域保留原节点，独立覆盖层只承载滑块，不占用内容宽度。 */
export class Scrollbars {
	private readonly entries = new Map<HTMLElement, { instance: ScrollInstance; layer: HTMLElement }>();
	private readonly observer = new ResizeObserver(() => this.update());

	attach(viewport: HTMLElement): void {
		if (this.entries.has(viewport))
			return;
		const layer = document.createElement('div');
		layer.className = 'scroll-layer';
		viewport.parentElement!.append(layer);
		const instance = OverlayScrollbars({
			target: viewport,
			elements: { viewport },
			scrollbars: { slot: layer },
		}, {
			showNativeOverlaidScrollbars: false,
			overflow: { x: 'scroll', y: 'scroll' },
			scrollbars: {
				theme: 'os-theme-bomcheck',
				visibility: 'auto',
				autoHide: 'leave',
				autoHideDelay: 700,
				dragScroll: true,
				clickScroll: true,
			},
		});
		this.entries.set(viewport, { instance, layer });
		this.observer.observe(viewport);
		this.update();
	}

	/** 隐藏区域不显示轨道，显示后按原视口位置重新计算覆盖层。 */
	update(): void {
		for (const [viewport, { instance, layer }] of this.entries) {
			const visible = !!viewport.getClientRects().length && !!viewport.clientHeight;
			layer.hidden = !visible;
			if (!visible)
				continue;
			Object.assign(layer.style, {
				left: `${viewport.offsetLeft + viewport.clientLeft}px`,
				top: `${viewport.offsetTop + viewport.clientTop}px`,
				width: `${viewport.clientWidth}px`,
				height: `${viewport.clientHeight}px`,
			});
			instance.update();
		}
	}

	detach(viewport: HTMLElement): void {
		const entry = this.entries.get(viewport);
		if (!entry)
			return;
		this.observer.unobserve(viewport);
		entry.instance.destroy();
		entry.layer.remove();
		this.entries.delete(viewport);
	}

	dispose(): void {
		this.observer.disconnect();
		for (const viewport of this.entries.keys()) this.detach(viewport);
	}
}
