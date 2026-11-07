import { FILE_PICKER_SETTLE_MS } from './rules';

/** 文件选择只使用内联窗口自己的标准控件，不访问宿主页面或本地文件路径。 */
export class FilePicker {
	private cancel?: () => void;

	/** 每次使用独立控件，相同文件可以再次选取，取消和关闭窗口都能释放等待。 */
	choose(): Promise<File | undefined> {
		this.dispose();
		return new Promise((resolve, reject) => {
			const control = document.createElement('input');
			control.type = 'file';
			control.accept = '.xlsx,.xls,.csv,.tsv';
			control.hidden = true;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let finished = false;
			const finish = (file?: File, error?: unknown): void => {
				if (finished)
					return;
				finished = true;
				clearTimeout(timer);
				window.removeEventListener('focus', focus);
				control.remove();
				this.cancel = undefined;
				if (error)
					reject(error);
				else
					resolve(file);
			};
			// 旧浏览器没有cancel事件时，焦点返回后给文件change事件留出处理时间。
			function focus(): void {
				clearTimeout(timer);
				timer = setTimeout(() => finish(control.files?.[0]), FILE_PICKER_SETTLE_MS);
			}
			this.cancel = () => finish();
			control.addEventListener('change', () => finish(control.files?.[0]), { once: true });
			control.addEventListener('cancel', () => finish(), { once: true });
			window.addEventListener('focus', focus);
			document.body.append(control);
			try {
				control.click();
			}
			catch (error) {
				finish(undefined, error);
			}
		});
	}

	/** 关闭内联窗口时移除控件与事件订阅，未完成的选择返回取消。 */
	dispose(): void {
		this.cancel?.();
	}
}
