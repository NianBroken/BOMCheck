import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import fs from 'node:fs/promises';
import process from 'node:process';

/** 编辑器输入通道拖动真实滑块，截图来自同一真实客户端渲染页面。 */
async function main() {
	const port = process.argv[2];
	const label = port === '9224'
		? '32'
		: '41';
	const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(response => response.json());
	const target = targets.find(target => target.type === 'page' && target.url.includes('/editor'));
	const contextId = JSON.parse(await fs.readFile(`tests/output/seven-scroll${label}.json`, 'utf8')).contextId;
	const socket = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise(resolve => socket.addEventListener('open', resolve, { once: true }));
	let serial = 0;
	const pending = new Map();
	socket.addEventListener('message', (event) => {
		const response = JSON.parse(event.data);
		if (response.id) {
			const request = pending.get(response.id);
			pending.delete(response.id);
			clearTimeout(request.timer);
			if (response.error)
				request.reject(new Error(JSON.stringify(response.error)));
			else request.resolve(response.result);
		}
	});
	function call(method, params = {}) {
		return new Promise((resolve, reject) => {
			const id = ++serial;
			const timer = setTimeout(() => reject(new Error(`客户端输入超时：${method}`)), 10000);
			pending.set(id, { resolve, reject, timer });
			socket.send(JSON.stringify({ id, method, params }));
		});
	}
	async function evaluate(expression, ui = true) {
		const result = await call('Runtime.evaluate', {
			expression,
			contextId: ui ? contextId : undefined,
			returnByValue: true,
			awaitPromise: true,
		});
		assert.ok(!result.exceptionDetails, '坐标读取不得抛出异常');
		return result.result.value;
	}
	try {
		await evaluate('document.getElementById(\'tab-preview\').click();true');
		await new Promise(resolve => setTimeout(resolve, 300));
		const frame = await evaluate('[...document.querySelectorAll(\'iframe\')].find(f=>f.src.startsWith(\'blob:\')).getBoundingClientRect().toJSON()', false);
		for (const axis of ['horizontal', 'vertical']) {
			const rect = await evaluate(`document.querySelector('#preview .os-scrollbar-${axis} .os-scrollbar-handle').getBoundingClientRect().toJSON()`);
			const start = { x: frame.x + rect.x + rect.width / 2, y: frame.y + rect.y + rect.height / 2 };
			await call('Input.dispatchMouseEvent', { type: 'mouseMoved', ...start });
			await new Promise(resolve => setTimeout(resolve, 150));
			await call('Input.dispatchMouseEvent', {
				type: 'mousePressed',
				button: 'left',
				buttons: 1,
				clickCount: 1,
				...start,
			});
			let point = start;
			try {
				for (let step = 1; step <= 8; step++) {
					point = { x: start.x + (axis === 'horizontal'
						? step * 12
						: 0), y: start.y + (axis === 'vertical'
						? step * 5
						: 0) };
					await call('Input.dispatchMouseEvent', {
						type: 'mouseMoved',
						button: 'left',
						buttons: 1,
						...point,
					});
				}
			}
			finally {
				await call('Input.dispatchMouseEvent', {
					type: 'mouseReleased',
					button: 'left',
					buttons: 0,
					clickCount: 1,
					...point,
				});
			}
		}
		await new Promise(resolve => setTimeout(resolve, 200));
		const result = await evaluate('(()=>{const h=document.querySelector(\'#preview .tabulator-tableholder\');return {left:h.scrollLeft,top:h.scrollTop,header:document.querySelector(\'#preview .tabulator-header-contents\').scrollLeft,noGutter:h.offsetWidth===h.clientWidth&&h.offsetHeight===h.clientHeight};})()');
		assert.ok(result.left > 0 && result.top > 0);
		assert.ok(Math.abs(result.left - result.header) < 2 && result.noGutter);
		const screenshot = await call('Page.captureScreenshot', {
			format: 'png',
			clip: {
				x: frame.x,
				y: frame.y,
				width: frame.width,
				height: frame.height,
				scale: 1,
			},
		});
		await fs.writeFile(`tests/output/screenshots/seven-scroll-drag${label}.png`, Buffer.from(screenshot.data, 'base64'));
		await fs.writeFile(`tests/output/seven-pointer${label}.json`, JSON.stringify(result, null, 2), 'utf8');
		console.log(JSON.stringify({ label, ...result }));
	}
	finally {
		socket.close();
		for (const request of pending.values()) clearTimeout(request.timer);
	}
}
void main();
