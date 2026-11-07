import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import process from 'node:process';

/** 重开已安装的最终扩展，核对默认状态与实际脚本，并按上下文归属审查日志。 */
async function main() {
	const report = { clients: [], scope: '最终扩展重新打开后的执行上下文，宿主历史日志原样保留并单独统计。' };
	for (const [label, port] of [
		['32', '9224'],
		['41', '9225'],
	]) {
		let serial = 0;
		async function evaluate(code, name, scope = 'root') {
			const source = `tests/output/info-final-${label}-current.js`;
			const output = `tests/output/info-final-${label}-${++serial}-${name}.json`;
			await fs.writeFile(source, code, 'utf8');
			const result = spawnSync(process.execPath, [
				'tests/ui-client.mjs',
				port,
				source,
				output,
				scope,
			], { encoding: 'utf8' });
			assert.equal(result.status, 0, result.stderr || result.stdout);
			return JSON.parse(await fs.readFile(output, 'utf8'));
		}
		if ((await evaluate(`!!document.querySelector('iframe[src^=blob]')`, 'window-exists')).result.result.value) {
			await evaluate(`setTimeout(()=>eda.sys_IFrame.closeIFrame('bomcheck-main'),30);true`, 'close', 'ui');
			await evaluate(`(async()=>{const end=Date.now()+10000;while(document.querySelector('iframe[src^=blob]')){if(Date.now()>end)throw Error('测试窗口关闭超时');await new Promise(r=>setTimeout(r,40));}return true;})()`, 'closed');
		}
		await evaluate(await fs.readFile('tests/fixtures/open-extension-menu.js', 'utf8'), 'menu');
		await evaluate(`document.querySelector('[data-test="启动核对"]').click();true`, 'open');
		await evaluate(`(async()=>{const end=Date.now()+30000;while(document.getElementById('refresh').disabled){if(Date.now()>end)throw Error('扩展初始范围读取超时');await new Promise(r=>setTimeout(r,40));}return document.getElementById('scope').options.length;})()`, 'ready', 'ui');
		const data = await evaluate(await fs.readFile('tests/fixtures/final-smoke.js', 'utf8'), 'smoke', 'ui');
		const smoke = data.result.result.value;
		assert.equal(smoke.defaultFilePage, true);
		assert.equal(smoke.visiblePanels, 1);
		assert.equal(smoke.ignoreCase, true);
		assert.deepEqual(smoke.separators, [',', '，', '、']);
		await fs.writeFile(`tests/output/info-${label}-smoke.json`, JSON.stringify(smoke, null, 2), 'utf8');
		const own = [];
		const host = new Map();
		for (const event of data.events) {
			const params = event.params;
			const type = event.method === 'Runtime.exceptionThrown'
				? 'exception'
				: params.type;
			if (!['warning', 'error', 'exception'].includes(type))
				continue;
			const context = params.executionContextId ?? params.exceptionDetails?.executionContextId;
			const text = params.exceptionDetails?.text ?? params.args?.map(value => value.value ?? value.description ?? '').join(' ');
			if (context === data.contextId)
				own.push({ type, text });
			else
				host.set(type, (host.get(type) ?? 0) + 1);
		}
		assert.deepEqual(own, []);
		report.clients.push({
			label,
			contextId: data.contextId,
			extensionWarnings: 0,
			extensionErrors: 0,
			extensionExceptions: 0,
			hostHistory: Object.fromEntries(host),
			rawLog: `info-final-${label}-${serial}-smoke.json`,
		});
	}
	await fs.writeFile('tests/output/info-console-review.json', JSON.stringify(report, null, 2), 'utf8');
	console.log('两客户端最终脚本、默认状态和扩展自身日志审查通过');
}
void main();
