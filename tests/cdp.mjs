/** 调试通道只连接本机测试客户端，用于读取真实宿主状态和控制台记录。 */
import { readFile, writeFile } from 'node:fs/promises';
import process from 'node:process';

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
	let serial = 0;
	const requests = new Map();
	const events = [];
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
		await call('Runtime.enable');
		await call('Log.enable');
		const expression = await readFile(sourceFile, 'utf8');
		const result = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
		const output = { target: target.id, result, events };
		if (outputFile)
			await writeFile(outputFile, JSON.stringify(output, null, 2), 'utf8');
		console.log(JSON.stringify(output));
	}
	finally {
		socket.close();
		for (const request of requests.values()) clearTimeout(request.timer);
	}
}

void main();
