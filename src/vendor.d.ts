/** 浏览器ZIP构建只暴露归档规范化所需接口，不引入Node全局类型。 */
declare module 'jszip/dist/jszip.min.js' {
	const JSZip: {
		loadAsync: (bytes: ArrayBuffer | Uint8Array, options: { checkCRC32: boolean }) => Promise<{
			generateAsync: (options: { type: 'uint8array'; compression: 'STORE'; streamFiles: boolean }) => Promise<Uint8Array>;
		}>;
	};
	export default JSZip;
}

/** 表格库公开接口的最小类型面，业务层只依赖实际使用的能力。 */
declare module 'tabulator-tables' {
	export class TabulatorFull {
		constructor(element: HTMLElement, options: Record<string, unknown>);
		on(event: 'tableBuilt', callback: () => void): void;
		on(event: 'rowDblClick', callback: (event: Event, row: { getData: () => { original: Record<string, unknown> } }) => void): void;
		setColumns(columns: Record<string, unknown>[]): void;
		setData(data: Record<string, unknown>[]): Promise<void>;
		redraw(force?: boolean): void;
		destroy(): void;
	}
}
