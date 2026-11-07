/**
 * 管理内嵌页面自己的原生文件选择控件，以及等待选择期间的取消和释放。
 * 选择结果为浏览器 File 对象，不接触宿主页面的控件或用户文件系统路径。
 */
import { FILE_PICKER_SETTLE_MS } from './rules';

/** 文件选择只使用内联窗口自己的标准控件，不访问宿主页面或本地文件路径。 */
export class FilePicker {
	/**
	 * 保存当前尚未完成选择的取消闭包；没有等待中的选择时保持未定义。
	 */
	private cancel?: () => void;

	/**
	 * 每次创建独立隐藏 input，允许用户再次选择与上次相同的文件。
	 * 先结束上一个等待，再用 change、cancel 或焦点返回路径结束当前运行 Promise。
	 * 用户取消返回 undefined，控件打开时的异常拒绝 Promise，所有路径共用一次性清理。
	 */
	choose(): Promise<File | undefined> {
		this.dispose();
		return new Promise((resolve, reject) => {
			const control = document.createElement('input');
			control.type = 'file';
			control.accept = '.xlsx,.xls,.csv,.tsv';
			control.hidden = true;
			let timer: ReturnType<typeof setTimeout> | undefined;
			let finished = false;
			/**
			 * finished 防止多种浏览器事件重复结束同一次等待。
			 * 结束时撤销定时器、焦点监听并移除 input，随后才报告文件、取消或异常。
			 */
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
			/**
			 * 对话框返回页面焦点后等待约定时间，再读取控件的首个文件。
			 * change 或 cancel 若先到达，会通过同一结束入口撤销该定时器。
			 */
			function focus(): void {
				clearTimeout(timer);
				timer = setTimeout(() => finish(control.files?.[0]), FILE_PICKER_SETTLE_MS);
			}
			this.cancel = () => finish();
			/**
			 * 只读取首个文件，控件未设置多选；两个结束事件均只监听一次。
			 * 无论事件是否触发，节点移除与窗口焦点监听清理都由 finish 负责。
			 */
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

	/**
	 * 存在待选流程时触发其取消闭包，移除控件和监听，使尚未完成的 Promise 返回取消。
	 */
	dispose(): void {
		this.cancel?.();
	}
}
