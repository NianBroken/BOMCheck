import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import process from 'node:process';

/** 所有工程修改只作用于既有独立验收副本，结束时恢复属性并撤销测试删除。 */
async function main() {
	const [port, handle, python = 'python'] = process.argv.slice(2);
	const label = port === '9224'
		? '32'
		: '41';
	const output = 'tests/output';
	await fs.mkdir(output, { recursive: true });
	await fs.writeFile(`${output}/UI_覆盖验收.csv`, '\uFEFF位号,测试描述,测试编号\r\nC54,界面验收描述甲,000001\r\nC55,界面验收描述乙,000002\r\n', 'utf8');
	await fs.writeFile(`${output}/UI_错误隔离.csv`, '\uFEFF位号,测试描述,测试编号\r\nC54,冲突甲,000003\r\nC54,冲突乙,000003\r\nC55,有效器件描述,000004\r\n,无位号行,000005\r\n', 'utf8');
	function run(command, args) {
		const result = spawnSync(command, args, { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	async function evaluate(source, name, scope = 'ui') {
		const script = `${output}/seven-current-${label}.js`;
		const destination = `${output}/seven-${name}${label}.json`;
		await fs.writeFile(script, source, 'utf8');
		run(process.execPath, [
			'tests/ui-client.mjs',
			port,
			script,
			destination,
			scope,
		]);
		const value = JSON.parse(await fs.readFile(destination, 'utf8')).result.result.value;
		if (value?.components)
			value.components.sort((a, b) => a.id.localeCompare(b.id));
		return value;
	}
	const read = await fs.readFile('tests/fixtures/read-components.js', 'utf8');
	const before = await evaluate(read, 'before');
	assert.ok(before.project.startsWith('BOMCheck_'), '工程必须为独立测试副本');
	assert.equal(before.components.length, 479);
	const originals = before.components.filter(component => ['C54', 'C55'].includes(component.ref));
	assert.equal(originals.length, 2);
	async function choose(file) {
		await evaluate('document.getElementById(\'tab-file\').click();true', 'file-page');
		run(python, [
			'tests/native-file.py',
			'--handle',
			handle,
			'--file',
			file,
		]);
		await evaluate(`(async()=>{const deadline=Date.now()+15000;while(document.getElementById('refresh').disabled||document.getElementById('filename').textContent!==${JSON.stringify(file.split(/[\\/]/u).at(-1))}){if(Date.now()>deadline)throw Error('文件解析未完成');await new Promise(r=>setTimeout(r,50));}return document.getElementById('filename').textContent;})()`, 'file-ready');
		run(process.execPath, [
			'tests/ui-client.mjs',
			port,
			'tests/fixtures/check-await.js',
			`${output}/seven-current-check${label}.json`,
			'ui',
		]);
	}
	async function mapping(count) {
		await evaluate(`(async()=>{const $=id=>document.getElementById(id);$('tab-mapping').click();for(const b of [...$('mappings').querySelectorAll('button')])b.click();for(let i=0;i<${count};i++){$('addMapping').click();while($('addMapping').disabled)await new Promise(r=>setTimeout(r,20));const row=$('mappings').children[i],s=row.querySelectorAll('select');s[0].value='col:'+(i+1);s[1].value=i?'standard:supplierId':'other:Description';if(!s[0].value||!s[1].value)throw Error('实际字段不可选');for(const c of s)c.dispatchEvent(new Event('change'));}$('previewWritesButton').click();while($('previewWritesButton').disabled)await new Promise(r=>setTimeout(r,20));return {status:$('status').textContent,rows:$('mappings').children.length};})()`, 'mappings');
	}
	async function action(id, answer) {
		await evaluate(`document.getElementById('${id}').click();true`, `start-${id}`);
		if (answer) {
			run(python, [
				'tests/desktop.py',
				'click',
				'--handle',
				handle,
				'--name',
				answer,
				'--kind',
				'Button',
			]);
		}
		return evaluate(`(async()=>{const deadline=Date.now()+30000;while(document.getElementById('refresh').disabled){if(Date.now()>deadline)throw Error('批次执行超时');await new Promise(r=>setTimeout(r,50));}document.getElementById('tab-operation').click();await new Promise(r=>setTimeout(r,100));return {status:document.getElementById('status').textContent,rows:[...document.querySelectorAll('#operation .tabulator-row')].map(r=>r.textContent)};})()`, `result-${id}-${answer ?? 'direct'}`);
	}
	const report = { label };
	try {
		await choose(`${output}/UI_覆盖验收.csv`);
		await mapping(2);
		await action('run', '取消');
		const cancelled = await evaluate(read, 'cancelled');
		assert.deepEqual(cancelled.components, before.components);
		await evaluate(await fs.readFile('tests/fixtures/check-await.js', 'utf8'), 'recheck');
		await mapping(2);
		const completed = await action('run', '确定');
		const after = await evaluate(read, 'after');
		assert.ok(completed.status.includes('成功 4'));
		for (const original of before.components) {
			const actual = after.components.find(component => component.id === original.id);
			if (['C54', 'C55'].includes(original.ref)) {
				assert.equal(actual.other.Description, original.ref === 'C54'
					? '界面验收描述甲'
					: '界面验收描述乙');
				assert.equal(actual.supplier, original.ref === 'C54'
					? '000001'
					: '000002');
				assert.deepEqual({ ...actual.other, Description: original.other.Description }, original.other);
			}
			else {
				assert.deepEqual(actual, original);
			}
		}
		report.multipleMappings = { verifiedFields: 4, cancelUnchanged: true, unrelatedPropertiesPreserved: true };
		await choose(`${output}/UI_错误隔离.csv`);
		await mapping(2);
		const isolated = await action('run', '确定');
		assert.ok(isolated.status.includes('成功 3'));
		const isolation = await evaluate(read, 'isolated');
		assert.equal(isolation.components.find(component => component.ref === 'C54').other.Description, '界面验收描述甲');
		assert.equal(isolation.components.find(component => component.ref === 'C54').supplier, '000003');
		assert.equal(isolation.components.find(component => component.ref === 'C55').other.Description, '有效器件描述');
		report.errorIsolation = { successfulFields: 3, conflictExcluded: true };
		const single = `${output}/seven-single${label}.csv`;
		await fs.writeFile(single, '位号,描述\nC54,七项空白直填\n', 'utf8');
		await evaluate(`(async()=>{const c=${JSON.stringify(originals.find(component => component.ref === 'C54'))};if(!await eda.pcb_PrimitiveComponent.modify(c.id,{otherProperty:{...c.other,Description:' '}}))throw Error('测试空白准备失败');return true;})()`, 'prepare-blank');
		await choose(single);
		await mapping(1);
		const direct = await action('run');
		assert.ok(direct.status.includes('成功 1'));
		assert.equal((await evaluate(read, 'direct')).components.find(component => component.ref === 'C54').other.Description, '七项空白直填');
		report.singleMapping = { successfulFields: 1, noOverwriteDialog: true };
	}
	finally {
		await evaluate(`(async()=>{for(const c of ${JSON.stringify(originals)}){if(!await eda.pcb_PrimitiveComponent.modify(c.id,{supplierId:c.supplier,otherProperty:c.other}))throw Error('原值恢复失败');}await eda.pcb_Document.save();return true;})()`, 'restore');
	}
	assert.deepEqual((await evaluate(read, 'restored')).components, before.components);
	const deletion = `${output}/seven-delete${label}.csv`;
	await fs.writeFile(deletion, `位号\n${before.components.filter(component => component.ref !== 'C54').map(component => `"${component.ref.replaceAll('"', '""')}"`).join('\n')}\n`, 'utf8');
	await choose(deletion);
	await evaluate('document.getElementById(\'tab-project\').click();true', 'delete-page');
	await action('delete', '取消');
	assert.deepEqual((await evaluate(read, 'delete-cancelled')).components, before.components);
	await evaluate(await fs.readFile('tests/fixtures/check-await.js', 'utf8'), 'delete-recheck');
	await evaluate('document.getElementById(\'tab-project\').click();true', 'delete-page-again');
	const deleted = await action('delete', '确定');
	const remaining = await evaluate(read, 'deleted');
	assert.equal(remaining.components.length, 478);
	assert.ok(!remaining.components.some(component => component.ref === 'C54'));
	assert.ok(deleted.rows.some(row => row.includes('删除成功')));
	await evaluate('setTimeout(()=>eda.sys_IFrame.closeIFrame(\'bomcheck-main\'),100);true', 'close-before-undo');
	await evaluate(`document.querySelector('[title="撤销(Ctrl+Z)"]').click();true`, 'undo-toolbar', 'root');
	for (const file of ['open-extension-menu.js', 'open-extension.js']) {
		run(process.execPath, [
			'tests/ui-client.mjs',
			port,
			`tests/fixtures/${file}`,
			`${output}/seven-undo-${file}-${label}.json`,
			'root',
		]);
	}
	const restored = await evaluate(read, 'delete-restored');
	const undoMetadata = [];
	for (const actual of restored.components) {
		const original = before.components.find(component => component.id === actual.id);
		assert.ok(original, '撤销后的器件身份必须存在于原始快照');
		for (const key of Object.keys(actual.other).filter(key => !(key in original.other))) {
			assert.ok(['Channel ID', 'Group ID', 'Reuse Block'].includes(key) && actual.other[key] === '', '宿主只能补入已知的空内部属性');
			undoMetadata.push({ id: actual.id, key, value: actual.other[key] });
		}
		assert.deepEqual({
			...actual,
			other: Object.fromEntries(Object.keys(original.other).map(key => [key, actual.other[key]])),
		}, original);
	}
	assert.equal(restored.components.length, before.components.length);
	await evaluate('(async()=>{await eda.pcb_Document.save();return true;})()', 'save-restored');
	const final = await evaluate(read, 'final');
	assert.deepEqual(final.components, restored.components);
	report.deletion = {
		cancelledUnchanged: true,
		confirmedRemoved: 1,
		undoRestored: true,
		finalComponents: 479,
		undoMetadata,
	};
	await fs.writeFile(`${output}/seven-operations${label}.json`, JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
void main();
