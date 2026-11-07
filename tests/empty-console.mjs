import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/** 按真实执行上下文归属审查日志，保留宿主历史记录，不把宿主信息记为扩展结果。 */
async function main() {
	const report = { clients: [], scope: '重新打开最终扩展窗口后的真实执行上下文，宿主历史日志保留在原始记录中。' };
	const files = await fs.readdir('tests/output');
	for (const label of ['32', '41']) {
		const source = files.find(name => name.startsWith(`empty-final-${label}-`) && name.endsWith('-smoke.json'));
		assert.ok(source);
		const data = JSON.parse(await fs.readFile(`tests/output/${source}`, 'utf8'));
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
			rawLog: source,
		});
	}
	await fs.writeFile('tests/output/empty-console-review.json', JSON.stringify(report, null, 2), 'utf8');
	console.log('两个最终扩展窗口未产生扩展自身错误、告警或未处理异常，宿主历史记录单独保留');
}
void main();
