/**
 * 连接显式端口对应的本机调试目标，执行测试脚本并记录异常和日志事件。
 * 该入口是测试观察工具，不进入插件安装包，也不替代业务层公开宿主 API。
 * 端口、脚本路径和可选报告路径全部来自命令行，脚本结果保留协议原始结构，便于定位运行时异常。
 */
/** 调试通道只连接本机测试客户端，用于读取真实宿主状态和控制台记录。 */
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

/**
 * 从参数读取端口、脚本和可选报告路径，定位编辑器页面并建立 WebSocket。
 */
async function main() {
	const [port, sourceFile, outputFile] = process.argv.slice(2);
	const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
	const target = targets.find(item => item.type === 'page' && item.url.includes('/editor'));
	if (!target)
		throw new Error('测试客户端没有编辑器页面');
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		socket.addEventListener('open', resolve, { once: true });
		socket.addEventListener('error', reject, { once: true });
	});
	/**
	 * 请求使用递增 id 与 Promise 映射，异步事件单独保存，不与请求返回混合。
	 */
	let serial = 0;
	const requests = new Map();
	const events = [];
	/**
	 * 按返回 id 找到等待请求、移除计时器并兑现或拒绝；异常和日志事件进入独立证据列表。
	 */
	socket.addEventListener('message', (event) => {
		const message = JSON.parse(event.data);
		if (message.id) {
			const request = requests.get(message.id);
			if (!request)
				return;
			requests.delete(message.id);
			clearTimeout(request.timer);
			if (message.error)
				request.reject(new Error(JSON.stringify(message.error)));
			else request.resolve(message.result);
		}
		else if (message.method === 'Runtime.exceptionThrown' || message.method === 'Log.entryAdded') {
			events.push(message);
		}
	});
	/**
	 * 为单次调试请求建立六十秒超时，超时删除等待项并明确报告方法名。
	 */
	function call(method, params = {}) {
		return new Promise((resolve, reject) => {
			const id = ++serial;
			const timer = setTimeout(() => {
				requests.delete(id);
				reject(new Error(`调试请求超时：${method}`));
			}, 60000);
			requests.set(id, { resolve, reject, timer });
			socket.send(JSON.stringify({ id, method, params }));
		});
	}
	try {
		// 先打开运行时和日志域，再执行脚本，保证脚本期间产生的异常与日志都能进入同一份报告。
		await call('Runtime.enable');
		await call('Log.enable');
		const expression = await readFile(sourceFile, 'utf8');
		const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		const output = { target: target.id, result, events };
		if (outputFile)
			await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8');
		console.log(JSON.stringify(output));
	}
	/**
	 * 关闭调试连接并撤销仍保存的定时器，避免进程因等待任务继续持有计时资源。
	 */
	finally {
		socket.close();
		for (const request of requests.values()) clearTimeout(request.timer);
	}
}

void main();
