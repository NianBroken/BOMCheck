/**
 * 在真实扩展窗口验证清单预览、双表导出、有序属性合并和删除确认。
 * 端口与窗口句柄由参数提供，参考文件由环境变量指定，工程名称必须属于独立测试范围。
 * 不同模式执行的场景不同，合并测试在 finally 恢复原属性，删除模式显式通过宿主撤销恢复。
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as XLSX from 'xlsx';
import { exportInfo, jsonExportInfo } from '../export-info.mjs';
import { withTestOutput } from './test-output.mjs';

/**
 * 每次输出使用独立临时目录，测试步骤脚本和 JSON 证据按序号命名。
 * 启动时关闭旧扩展窗口并从真实菜单打开，验证默认设置后才读取测试工程。
 */
async function main(outputDirectory) {
	const [port, handle] = process.argv.slice(2);
	const label = String(port);
	const prefix = `${outputDirectory}/merge-${label}`;
	let serial = 0;
	/**
	 * 同步等待子脚本结束，非零退出状态带实际标准错误或输出进入断言，不继续假定操作成功。
	 */
	function run(command, args) {
		const execution = spawnSync(command, args, {
			encoding: 'utf8',
			env: { ...process.env, PYTHONUTF8: '1' },
		});
		assert.equal(execution.status, 0, execution.stderr || execution.stdout);
	}
	/**
	 * 将代码写为 UTF-8 临时文件，按根页面或扩展页面上下文执行，再从返回报告取普通值。
	 */
	async function evaluate(code, name, scope = 'ui') {
		const source = `${prefix}-current.js`;
		const output = `${prefix}-${String(++serial).padStart(3, '0')}-${name}.json`;
		await fs.writeFile(source, code, 'utf8');
		run(process.execPath, [
			'tests/ui-client.mjs',
			port,
			source,
			output,
			scope,
		]);
		return JSON.parse(await fs.readFile(output, 'utf8')).result.result.value;
	}
	/**
	 * 注入每次界面表达式共用的控件定位及有限等待函数，等待错误包含实际顶部状态。
	 */
	const ready = `const $=id=>document.getElementById(id);const wait=async(test)=>{const end=Date.now()+45000;while(!test()){if(Date.now()>end)throw Error('界面状态等待超时：'+$('status').textContent);await new Promise(r=>setTimeout(r,40));}};`;
	const idle = `(async()=>{${ready}await wait(()=>!$('refresh').disabled);return $('status').textContent;})()`;
	if (await evaluate('!!document.querySelector("iframe[src^=blob]")', 'window-exists', 'root')) {
		await evaluate('setTimeout(()=>eda.sys_IFrame.closeIFrame("bomcheck-main"),30);true', 'close-existing');
		await evaluate('(async()=>{while(document.querySelector("iframe[src^=blob]"))await new Promise(r=>setTimeout(r,40));return true;})()', 'closed-existing', 'root');
	}
	await evaluate(await fs.readFile('tests/fixtures/merge-close-manager.js', 'utf8'), 'manager-close', 'root');
	await evaluate(await fs.readFile('tests/fixtures/open-extension-menu.js', 'utf8'), 'open-menu', 'root');
	await evaluate('document.querySelector(\'[data-test="启动核对"]\').click();true', 'open-window', 'root');
	await evaluate(idle, 'ready');
	const smoke = await evaluate(await fs.readFile('tests/fixtures/final-smoke.js', 'utf8'), 'smoke');
	await fs.writeFile(`${outputDirectory}/merge-smoke${label}.json`, JSON.stringify(smoke, null, 2), 'utf8');
	assert.equal(smoke.defaultFilePage, true);
	assert.equal(smoke.ignoreCase, true);
	/**
	 * 通过公开 eda 接口读取真实当前工程和器件，拒绝非 BOMCheck_ 工程。
	 * 快照按图元 id 排序，便于取消和恢复后进行完整结构比较。
	 */
	const read = `(async()=>{const p=await eda.dmt_Project.getCurrentProjectInfo();if(!p.friendlyName.startsWith('BOMCheck_'))throw Error('测试范围必须为独立工程');return {project:p.friendlyName,version:eda.sys_Environment.getEditorCurrentVersion(),components:(await eda.pcb_PrimitiveComponent.getAll()).map(c=>({id:c.getState_PrimitiveId(),ref:c.getState_Designator(),name:c.getState_Name(),supplier:c.getState_SupplierId(),other:c.getState_OtherProperty()})).sort((a,b)=>a.id.localeCompare(b.id))};})()`;
	const before = await evaluate(read, 'before');
	assert.equal(before.components.length, 479);
	const report = {
		label,
		version: before.version,
		fullPreview: [],
		merge: {},
		exported: [],
	};
	/**
	 * 切回文件设置页后用原生对话框导入指定文件，再等待任务锁解除。
	 */
	async function choose(file) {
		await evaluate('document.getElementById("tab-file").click();true', 'file-page');
		run('python', [
			'tests/native-file.py',
			'--handle',
			handle,
			'--file',
			file,
		]);
		await evaluate(idle, 'file-loaded');
	}
	/**
	 * 从实际控件触发核对，等待状态明确包含完成文字，不能只以按钮短暂可用判断完成。
	 */
	async function check() {
		await evaluate(`(async()=>{${ready}await wait(()=>!$('start').disabled);$('start').click();await wait(()=>!$('refresh').disabled&&$('status').textContent.includes('器件核对已经完成'));return $('summary').textContent;})()`, 'checked');
	}
	/**
	 * 删除当前运行同名输出后通过原生保存流程导出，最终文件必须存在且长度大于零。
	 */
	async function save(button, destination) {
		await fs.rm(destination, { force: true });
		run('python', [
			'tests/native-save.py',
			'--handle',
			handle,
			'--button',
			button,
			'--file',
			destination,
		]);
		await evaluate(idle, 'saved');
		assert.ok((await fs.stat(destination)).size > 0);
	}
	/**
	 * 删除场景只从完整位号清单移除 C54，确认差异仅对应测试目标。
	 * 先放弃删除核对全体不变，再真实删除、关闭扩展并用宿主撤销恢复。
	 */
	if (process.argv[4] === 'deletion') {
		const file = `${prefix}-delete.csv`;
		await fs.writeFile(file, `位号\n${before.components.filter(c => c.ref !== 'C54').map(c => `"${c.ref.replaceAll('"', '""')}"`).join('\n')}`, 'utf8');
		await choose(file);
		await check();
		await evaluate('document.getElementById("tab-project").click();true', 'delete-page');
		await action('delete', '放弃删除');
		assert.deepEqual((await evaluate(read, 'delete-cancelled')).components, before.components);
		await check();
		await action('delete', '确认删除');
		const remaining = await evaluate(read, 'deleted');
		assert.equal(remaining.components.length, 478);
		assert.ok(!remaining.components.some(c => c.ref === 'C54'));
		await evaluate('setTimeout(()=>eda.sys_IFrame.closeIFrame("bomcheck-main"),30);true', 'close-undo');
		await evaluate(`document.querySelector('[title="撤销(Ctrl+Z)"]').click();true`, 'undo-delete', 'root');
		await evaluate(await fs.readFile('tests/fixtures/open-extension-menu.js', 'utf8'), 'undo-menu', 'root');
		await evaluate(`document.querySelector('[data-test="启动核对"]').click();true`, 'undo-open', 'root');
		const restored = await evaluate(read, 'delete-restored');
		assert.equal(restored.components.length, 479);
		// 宿主撤销会写入空结构属性，原有业务字段必须逐项保持原值。
		for (const original of before.components) {
			const actual = restored.components.find(c => c.id === original.id);
			assert.equal(actual.ref, original.ref);
			assert.equal(actual.name, original.name);
			assert.equal(actual.supplier, original.supplier);
			for (const [key, value] of Object.entries(original.other)) assert.equal(actual.other[key], value);
		}
		await evaluate('eda.pcb_Document.save()', 'delete-save');
		await fs.writeFile(`${prefix}-deletion.json`, JSON.stringify({
			cancelUnchanged: true,
			deleted: 1,
			restored: 479,
			priorFieldsPreserved: true,
		}, null, 2), 'utf8');
		console.log('删除取消、实际删除及撤销恢复核验通过');
		return;
	}
	/**
	 * 完整基准模式必须显式传入参考目录，递归收集恰好三份非 Office 临时 Excel。
	 */
	const directory = process.env.BOMCHECK_REFERENCE_DIR;
	assert.ok(directory, '请设置BOMCHECK_REFERENCE_DIR为参考文件目录');
	const files = [];
	/**
	 * 参考目录递归遍历，保留真实文件路径供原生文件对话框读取。
	 */
	async function walk(dir) {
		for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
			const file = path.join(dir, entry.name);
			if (entry.isDirectory())
				await walk(file);
			else if (entry.name.endsWith('.xlsx') && !entry.name.startsWith('~$'))
				files.push(file);
		}
	}
	await walk(directory);
	assert.equal(files.length, 3);
	/**
	 * 逐份导入并滚动预览到底部，回读导出 Excel 检查空表、差异数量和身份属性。
	 */
	for (const file of files) {
		await choose(file);
		await check();
		const preview = await evaluate(`(async()=>{${ready}$('tab-preview').click();await new Promise(r=>setTimeout(r,150));const h=$('preview').querySelector('.tabulator-tableholder');h.scrollTop=h.scrollHeight;await new Promise(r=>setTimeout(r,150));return {state:$('previewState').textContent,last:[...$('preview').querySelectorAll('.tabulator-row')].at(-1)?.textContent,headers:[...$('preview').querySelectorAll('.tabulator-col-title')].map(e=>e.textContent)};})()`, 'preview-bottom');
		assert.ok(preview.state.includes(file.includes('0001084')
			? '481'
			: '480'));
		assert.ok(preview.last?.length);
		assert.ok(preview.headers.includes('原始行号'));
		report.fullPreview.push({ file, ...preview });
		await evaluate('document.getElementById("tab-file").click();true', 'export-page');
		const destination = `${prefix}-${file.match(/000(10\d\d)/u)[1]}.xlsx`;
		await save('export', destination);
		const book = XLSX.read(await fs.readFile(destination), { type: 'buffer' });
		assert.deepEqual(book.SheetNames, ['工程有_BOM无', 'BOM有_工程无']);
		assert.equal(book.Sheets[book.SheetNames[0]].A1.v, '当前工作表没有有效数据。');
		assert.equal(book.Sheets[book.SheetNames[0]]['!ref'], 'A1');
		assert.equal(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]]).length, file.includes('0001084')
			? 2
			: 1);
		assert.equal(book.Props.Author, exportInfo.author);
		assert.equal(book.Props.LastAuthor, exportInfo.author);
		assert.equal(book.Custprops.Copyright, exportInfo.copyright);
		assert.equal(book.Custprops.Website, exportInfo.website);
		assert.equal(book.Custprops.Link, exportInfo.link);
		report.exported.push(destination);
	}
	if (process.argv[4] === 'baselines') {
		await fs.writeFile(`${prefix}-baselines.json`, JSON.stringify(report, null, 2), 'utf8');
		console.log(JSON.stringify(report));
		return;
	}
	const csv = `${prefix}-sources.csv`;
	await fs.writeFile(csv, '\uFEFF位号,代号,描述,附加\r\nC54,001,甲,末\r\nC55,002,乙,\r\n', 'utf8');
	await choose(csv);
	await check();
	/**
	 * 仅保存本测试会写入的两个器件原值，恢复时按原图元 id 写回并保存。
	 */
	const originalTargets = before.components.filter(c => ['C54', 'C55'].includes(c.ref));
	assert.equal(originalTargets.length, 2);
	/**
	 * 通过真实映射控件建立目标和有序来源，change 事件驱动编辑器模型。
	 * 分隔符草稿只在多来源控件存在时设置，单来源不创建隐藏的文本区域。
	 */
	async function groups(config) {
		await evaluate(`(()=>{const $=id=>document.getElementById(id);$('tab-mapping').click();for(const b of [...$('mappings').querySelectorAll('[data-action="removeMapping"]')])b.click();for(const cfg of ${JSON.stringify(config)}){$('addMapping').click();const id=$('mappings').lastElementChild.dataset.group;const panel=()=>$('mappings').querySelector('[data-group="'+id+'"]');let target=panel().querySelector('select');target.value=cfg.target;target.dispatchEvent(new Event('change'));for(let i=0;i<cfg.columns.length;i++){if(i)panel().querySelector('[data-action="addSource"]').click();const s=panel().querySelectorAll('.mapping-source select')[i];s.value=cfg.columns[i];if(!s.value)throw Error('来源列不可选');s.dispatchEvent(new Event('change'));}const t=panel().querySelector('textarea');if(t){t.value=cfg.separator??'';t.dispatchEvent(new Event('input'));}}return [...$('mappings').querySelectorAll('button')].map(b=>b.textContent);})()`, 'mapping-configured');
	}
	/**
	 * 触发按钮后核实宿主确认框内容，再选择实际按钮，等待当前运行操作解除忙碌状态。
	 */
	async function action(id, answer) {
		await evaluate(`document.getElementById('${id}').click();true`, `click-${id}`);
		if (answer) {
			const confirmation = await evaluate('document.body.innerText.slice(-1100)', `confirm-${id}`, 'root');
			assert.ok(confirmation.includes(id === 'delete'
				? '删除范围'
				: '写入范围'));
			assert.ok(!confirmation.slice(confirmation.lastIndexOf(id === 'delete'
				? '删除范围'
				: '写入范围')).includes('LP.FM27'));
			run('python', [
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
		return evaluate(idle, `finished-${id}`);
	}
	try {
		await groups([
			{
				target: 'standard:name',
				columns: ['col:1', 'col:2'],
				separator: '|',
			},
			{
				target: 'other:Description',
				columns: ['col:2', 'col:3'],
				separator: '::',
			},
			{
				target: 'standard:supplierId',
				columns: ['col:1'],
				separator: '',
			},
		]);
		const labels = await evaluate('[...document.querySelectorAll("button")].map(b=>b.textContent.trim())', 'button-labels');
		for (const text of labels) assert.match(text, /^\p{Script=Han}{4}$/u);
		await action('previewWritesButton');
		await action('run', '放弃写入');
		assert.deepEqual((await evaluate(read, 'cancelled')).components, before.components);
		await check();
		await action('run', '确认写入');
		const written = await evaluate(read, 'written');
		for (const c of originalTargets) {
			const actual = written.components.find(a => a.id === c.id);
			assert.equal(actual.name, c.ref === 'C54'
				? '001|甲'
				: '002|乙');
			assert.equal(actual.other.Description, c.ref === 'C54'
				? '甲::末'
				: '乙');
			assert.equal(actual.supplier, c.ref === 'C54'
				? '001'
				: '002');
			assert.deepEqual({ ...actual.other, Description: c.other.Description }, c.other);
		}
		report.merge = {
			fieldsVerified: 6,
			orderPreserved: true,
			emptyFragmentsSkipped: true,
			cancelUnchanged: true,
		};
		await evaluate('document.getElementById("tab-operation").click();true', 'logs-page');
		await save('exportRecord', `${prefix}-operations.json`);
		const log = JSON.parse(await fs.readFile(`${prefix}-operations.json`, 'utf8'));
		assert.deepEqual(log.metadata, jsonExportInfo);
		assert.ok(log.operation.some(row => row.合并来源?.includes('代号')));
		await check();
		await groups([
			{
				target: 'standard:name',
				columns: ['col:1', 'col:2'],
				separator: '',
			},
		]);
		await evaluate(`(()=>{const p=document.querySelector('.mapping');p.querySelector('[data-action="moveDown"]').click();return true;})()`, 'reordered');
		await action('run', '确认写入');
		assert.equal((await evaluate(read, 'reordered-read')).components.find(c => c.ref === 'C54').name, '甲001');
		/**
		 * 相同位号不同来源片段形成列内冲突，即使直接拼接相同也必须隔离；另一器件仍应写入。
		 */
		const invalidFile = `${prefix}-conflict.csv`;
		await fs.writeFile(invalidFile, '\uFEFF位号,代号,描述\r\nC54,ab,c\r\nC54,a,bc\r\nC55,003,丙\r\n,无效,行\r\n', 'utf8');
		await choose(invalidFile);
		await check();
		await groups([
			{
				target: 'standard:name',
				columns: ['col:1', 'col:2'],
				separator: '',
			},
			{
				target: 'standard:supplierId',
				columns: ['col:2'],
				separator: ' ',
			},
		]);
		const isolatedStatus = await action('run', '确认写入');
		assert.ok(isolatedStatus.includes('成功 1'));
		const isolated = await evaluate(read, 'isolated');
		assert.equal(isolated.components.find(c => c.ref === 'C54').name, '甲001');
		assert.equal(isolated.components.find(c => c.ref === 'C55').name, '003丙');
		report.merge.conflictIsolated = true;
		report.merge.invalidSeparatorIsolated = true;
	}
	finally {
		await evaluate(`(async()=>{for(const c of ${JSON.stringify(originalTargets)}){if(!await eda.pcb_PrimitiveComponent.modify(c.id,{name:c.name,supplierId:c.supplier,otherProperty:c.other}))throw Error('测试属性恢复失败');}await eda.pcb_Document.save();return true;})()`, 'restore');
	}
	assert.deepEqual((await evaluate(read, 'restored')).components, before.components);
	await fs.writeFile(`${prefix}-report.json`, JSON.stringify(report, null, 2), 'utf8');
	console.log(JSON.stringify(report));
}
void withTestOutput(main);
