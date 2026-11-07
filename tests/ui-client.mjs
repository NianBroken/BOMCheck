/**
 * 在真实客户端的根页面或扩展界面上下文执行界面测试，保存返回值和控制台证据。
 * 页面上下文由实际 DOM 标识识别，截图路径和裁剪区域由环境变量显式传入。
 * root 模式保留宿主编辑器上下文，ui 模式只选择包含扩展 tabs 节点的执行上下文，避免把表达式发给错误窗口。
 */
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import process from 'node:process';

/**
 * 连接指定端口的编辑器页面，通过 Runtime 上下文列表定位扩展。
 * 默认 root 上下文供宿主界面观察，ui 需要实际找到带 tabs 节点的窗口。
 */
async function main() {
	const [port, source, output, scope = 'root'] = process.argv.slice(2);
	const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
	const target = targets.find(item => item.type === 'page' && item.url.includes('/editor'));
	if (!target)
		throw new Error('没有找到真实客户端编辑器');
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	let serial = 0;
	const pending = new Map();
	const contexts = [];
	const events = [];
	/**
	 * 请求响应解除计时器并返回对应结果，运行上下文和异常事件分别积累。
	 */
	socket.addEventListener('message', (event) => {
		const data = JSON.parse(event.data);
		if (data.id) {
			const request = pending.get(data.id);
			pending.delete(data.id);
			clearTimeout(request.timer);
			if (data.error)
				request.reject(new Error(JSON.stringify(data.error)));
			else request.resolve(data.result);
		}
		else if (data.method === 'Runtime.executionContextCreated') {
			contexts.push(data.params.context);
		}
		else if (data.method === 'Runtime.exceptionThrown' || data.method === 'Runtime.consoleAPICalled') {
			events.push(data);
		}
	});
	/**
	 * 把协议方法和参数发给当前连接，使用唯一请求 id 和超时报错，不依赖响应到达顺序。
	 */
	function call(method, params = {}) {
		return new Promise((resolve, reject) => {
			const id = ++serial;
			const timer = setTimeout(() => reject(new Error(`客户端请求超时：${method}`)), 60000);
			pending.set(id, { resolve, reject, timer });
			socket.send(JSON.stringify({ id, method, params }));
		});
	}
	try {
		await call('Runtime.enable');
		// 实际客户端必须处于前台，后台窗口的滚动事件和虚拟行绘制会被宿主延后。
		await call('Page.bringToFront');
		let contextId;
		/**
		 * 限定时间内逐上下文检查真实 tabs 节点，未找到时等待新上下文，不按固定编号猜测。
		 */
		if (scope === 'ui') {
			const deadline = Date.now() + 15000;
			while (!contextId && Date.now() < deadline) {
				for (const context of contexts) {
					const probe = await call('Runtime.evaluate', { expression: 'typeof document!=="undefined" && !!document.getElementById("tabs")', contextId: context.id, returnByValue: true });
					if (probe.result?.value === true) {
						contextId = context.id;
						break;
					}
				}
				if (!contextId)
					await new Promise(resolve => setTimeout(resolve, 100));
			}
			if (!contextId)
				throw new Error('扩展标签页未在限定时间内加载');
		}

		/**
		 * 按 UTF-8 读取测试表达式，在已选上下文等待其 Promise，返回普通值供报告序列化。
		 */
		const expression = await fs.readFile(source, 'utf8');
		const result = await call('Runtime.evaluate', {
			expression,
			contextId,
			userGesture: true,
			awaitPromise: true,
			returnByValue: true,
		});
		// 报告同时保存协议结果和事件列表，调用方可区分表达式返回值、异常详情及控制台输出。
		/**
		 * 截图和裁剪由调用者显式指定，Base64 图像转字节保存，页面结果和事件另存 JSON。
		 */
		if (process.env.BOMCHECK_SCREENSHOT) {
			const screenshot = await call('Page.captureScreenshot', {
				format: 'png',
				captureBeyondViewport: true,
				clip: JSON.parse(process.env.BOMCHECK_CLIP),
			});
			await fs.writeFile(process.env.BOMCHECK_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
		}
		const report = {
			target: target.id,
			contextId,
			result,
			events,
		};
		await fs.writeFile(output, JSON.stringify(report, null, 2), 'utf8');
		if (result.exceptionDetails)
			throw new Error(JSON.stringify(result.exceptionDetails));
		console.log(JSON.stringify(result.result.value));
	}
	/**
	 * 关闭 WebSocket 并清除尚未结束请求的定时器，不让联调连接保持占用。
	 */
	finally {
		socket.close();
		for (const request of pending.values()) clearTimeout(request.timer);
	}
}
void main();
