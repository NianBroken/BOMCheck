/**
 * 为面板、表格和详情维护独立覆盖滚动层，保留原始视口节点及其滚动行为。
 * 每个视口只登记一次，尺寸观察统一驱动位置重算，释放时删除实例和覆盖节点。
 */
import type { OverlayScrollbars as ScrollInstance } from 'overlayscrollbars';
import { ClickScrollPlugin, OverlayScrollbars } from 'overlayscrollbars';

/**
 * 在创建实例前注册点击轨道滚动能力，所有视口复用同一插件注册。
 */
OverlayScrollbars.plugin(ClickScrollPlugin);

/** 所有滚动区域保留原节点，独立覆盖层只承载滑块，不占用内容宽度。 */
export class Scrollbars {
	/**
	 * 以视口为键保存库实例和覆盖层，统一用于刷新与解除。
	 */
	private readonly entries = new Map<HTMLElement, { instance: ScrollInstance; layer: HTMLElement }>();
	/**
	 * 视口改变尺寸时请求所有可见区域更新，隐藏区域继续保持覆盖层隐藏。
	 */
	private readonly observer = new ResizeObserver(() => this.update());

	/**
	 * 重复视口直接返回，覆盖层插在原视口的父节点内，库仍使用原视口滚动。
	 * 横纵滚动均启用，采用共享主题，鼠标离开后按指定延迟隐藏。
	 */
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

	/**
	 * 根据实际客户区大小和偏移定位可见覆盖层，再请求库计算滑块范围。
	 * 不可见或零高度视口隐藏覆盖层，避免轨道浮在其他页面上。
	 */
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

	/**
	 * 解除尺寸观察、销毁库实例并移除覆盖层；未注册视口直接返回。
	 */
	detach(viewport: HTMLElement): void {
		const entry = this.entries.get(viewport);
		if (!entry)
			return;
		this.observer.unobserve(viewport);
		entry.instance.destroy();
		entry.layer.remove();
		this.entries.delete(viewport);
	}

	/**
	 * 停止观察并逐一解除全部视口，释放其节点和库实例。
	 */
	dispose(): void {
		this.observer.disconnect();
		for (const viewport of this.entries.keys()) this.detach(viewport);
	}
}
