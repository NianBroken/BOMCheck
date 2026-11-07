import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import process from 'node:process';

/** 调试连接只用于真实客户端的页面观察和测试操作，不替代宿主工程接口。 */
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

		const expression = await fs.readFile(source, 'utf8');
		const result = await call('Runtime.evaluate', {
			expression,
			contextId,
			userGesture: true,
			awaitPromise: true,
			returnByValue: true,
		});
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
	finally {
		socket.close();
		for (const request of pending.values()) clearTimeout(request.timer);
	}
}
void main();
