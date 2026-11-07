/**
 * 为实际使用但没有在当前工程直接提供声明的浏览器依赖建立最小类型接口。
 * 这里声明编译时形状，不创建运行对象，也不承诺依赖未列出的其他能力。
 */
/**
 * 浏览器 ZIP 构建暴露读取与重新生成归档所需能力。
 * 输入可为缓冲区或字节数组，读取明确要求 CRC32 校验，输出固定为字节数组。
 */
declare module 'jszip/dist/jszip.min.js' {
	const JSZip: {
		loadAsync: (bytes: ArrayBuffer | Uint8Array, options: { checkCRC32: boolean }) => Promise<{
			generateAsync: (options: { type: 'uint8array'; compression: 'STORE'; streamFiles: boolean }) => Promise<Uint8Array>;
		}>;
	};
	export default JSZip;
}

/**
 * 只声明表格包装类调用的构造、事件、列替换、数据替换、重绘和销毁方法。
 * 行双击事件的数据保留 original 引用，以便详情显示原始完整记录。
 */
declare module 'tabulator-tables' {
	export class TabulatorFull {
		constructor(element: HTMLElement, options: Record<string, unknown>);
		/**
		 * 表格初始结构构建完成后触发，包装层等待此事件再绑定行和滚动区域。
		 */
		on(event: 'tableBuilt', callback: () => void): void;
		/**
		 * 双击行时提供浏览器事件与取数对象，原始记录在 getData 的 original 字段中。
		 */
		on(event: 'rowDblClick', callback: (event: Event, row: { getData: () => { original: Record<string, unknown> } }) => void): void;
		/**
		 * 替换列定义，字段名由包装层生成，列标题与业务属性名分别维护。
		 */
		setColumns(columns: Record<string, unknown>[]): void;
		/**
		 * 替换表格数据并在库完成更新后兑现 Promise，包装层以此串行组织刷新。
		 */
		setData(data: Record<string, unknown>[]): Promise<void>;
		/**
		 * 重新计算现有表格布局，调用方另行保存和恢复滚动位置。
		 */
		redraw(force?: boolean): void;
		/**
		 * 释放当前表格实例的节点与监听，实例不再参与后续数据显示。
		 */
		destroy(): void;
	}
}
