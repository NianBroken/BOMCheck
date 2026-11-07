import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as XLSX from 'xlsx';
import { extensionInfo } from '../build/metadata.mjs';
import { exportInfo, jsonExportInfo } from '../export-info.mjs';

/** 新包通过真实菜单和文件对话框验收，工程读写仅使用公开接口并恢复测试原值。 */
async function main() {
	const [port, handle, mode = 'details'] = process.argv.slice(2);
	const label = port === '9224'
		? '32'
		: '41';
	const prefix = `tests/output/info-${label}`;
	let serial = 0;
	function run(command, args, extra = {}) {
		const result = spawnSync(command, args, {
			encoding: 'utf8',
			env: {
				...process.env,
				PYTHONUTF8: '1',
				...extra,
			},
		});
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	async function evaluate(code, name, scope = 'ui', extra = {}) {
		const source = `${prefix}-current.js`;
		const output = `${prefix}-step-${++serial}-${name}.json`;
		await fs.writeFile(source, code, 'utf8');
		run(process.execPath, [
			'tests/ui-client.mjs',
			port,
			source,
			output,
			scope,
		], extra);
		return JSON.parse(await fs.readFile(output, 'utf8')).result.result.value;
	}
	const ready = `const $=id=>document.getElementById(id);const wait=async test=>{const end=Date.now()+45000;while(!test()){if(Date.now()>end)throw Error('界面状态未就绪：'+$('status').textContent);await new Promise(r=>setTimeout(r,40));}};`;
	const idle = `(async()=>{${ready}await wait(()=>!$('refresh').disabled);return $('status').textContent;})()`;
	async function screenshot(name) {
		// 原生窗口保持可见，后台暂停的宿主动画不作为详情页截图。
		run('python', [
			'tests/desktop.py',
			'shot',
			'--handle',
			handle,
			'--path',
			`tests/output/screenshots/info-${label}-${name}.png`,
		]);
	}
	if ([
		'details',
		'details-current',
		'details-capture',
		'resume',
	].includes(mode)) {
		run('python', ['-c', `from pywinauto import Desktop; Desktop(backend="uia").window(handle=${Number(handle)}).wrapper_object().set_focus()`]);
		if (mode !== 'resume') {
			if (['details', 'details-capture'].includes(mode)) {
				if (await evaluate(`!!document.querySelector('iframe[src^=blob]')`, 'modal-window-exists', 'root')) {
					await evaluate(`setTimeout(()=>eda.sys_IFrame.closeIFrame('bomcheck-main'),30);true`, 'close-modal-window');
					await evaluate(`(async()=>{while(document.querySelector('iframe[src^=blob]'))await new Promise(r=>setTimeout(r,40));return true;})()`, 'modal-window-closed', 'root');
				}
				await evaluate(await fs.readFile('tests/fixtures/merge-close-manager.js', 'utf8'), 'close-existing-manager', 'root');
				await evaluate(await fs.readFile('tests/fixtures/open-advanced.js', 'utf8'), 'advanced', 'root');
				await evaluate(await fs.readFile('tests/fixtures/open-manager.js', 'utf8'), 'manager', 'root');
			}
			// 宿主广场异步请求结束后再切换已安装，避免请求返回覆盖详情选择。
			await evaluate(`(async()=>{const end=Date.now()+30000;while(![...document.querySelectorAll('div')].some(e=>e.textContent==='安装'&&e.children.length===0&&e.getClientRects().length)){if(Date.now()>end)throw Error('扩展管理器初始列表未就绪');await new Promise(r=>setTimeout(r,100));}return true;})()`, 'manager-list-ready', 'root');
			await evaluate(`[...document.querySelectorAll('span')].find(e=>e.textContent==='已安装').click();true`, 'installed', 'root');
			await evaluate(`[...document.querySelectorAll('div')].find(e=>e.className.includes('ellipsis')&&e.textContent==='物料核对').click();true`, 'detail-open', 'root');
			const details = await evaluate(`(async()=>{const deadline=Date.now()+10000;while(![...document.querySelectorAll('h2')].some(e=>e.textContent==='插件简介与适用场景')){if(Date.now()>deadline)throw Error('详情正文未加载');await new Promise(r=>setTimeout(r,50));}const h=[...document.querySelectorAll('h2')].map(e=>e.textContent),text=document.body.innerText;return {headings:h,metadata:text.slice(text.lastIndexOf('类型')),englishName:text.includes('英文名称：BOMCheck')};})()`, 'details', 'root');
			assert.equal(details.headings.length, 8);
			assert.equal(details.englishName, true);
			assert.ok(details.metadata.includes('>=3.2.0'));
			for (const value of extensionInfo.keywords)
				assert.ok(details.metadata.includes(value));
			await screenshot('details');
			await evaluate(`(()=>{const h=[...document.querySelectorAll('h2')].find(e=>e.textContent==='插件简介与适用场景');let e=h;while(e&&!(e.scrollHeight>e.clientHeight+10&&/auto|scroll/.test(getComputedStyle(e).overflowY)))e=e.parentElement;if(!e)throw Error('详情滚动区域不存在');e.scrollTop=e.scrollHeight;return true;})()`, 'details-bottom', 'root');
			await screenshot('details-end');
			await evaluate(`(()=>{const e=[...document.querySelectorAll('*')].find(e=>e.textContent==='配置'&&e.children.length===0&&e.getClientRects().length);if(!e)throw Error('配置标签不存在');e.click();return true;})()`, 'configuration', 'root');
			await screenshot('metadata');
			await fs.writeFile(`${prefix}-details.json`, JSON.stringify(details, null, 2), 'utf8');
			await evaluate(await fs.readFile('tests/fixtures/merge-close-manager.js', 'utf8'), 'manager-close', 'root');
			if (mode === 'details-capture') {
				console.log(`客户端${label}详情稳定画面采集通过`);
				return;
			}
		}
		if (await evaluate(`!!document.querySelector('iframe[src^=blob]')`, 'window-exists', 'root')) {
			await evaluate(`setTimeout(()=>eda.sys_IFrame.closeIFrame('bomcheck-main'),30);true`, 'close-existing-window');
			await evaluate(`(async()=>{while(document.querySelector('iframe[src^=blob]'))await new Promise(r=>setTimeout(r,40));return true;})()`, 'closed-window', 'root');
		}
		await evaluate(`document.querySelector('[data-test="Open Project"]').click();true`, 'project-open', 'root');
		const file = label === '32'
			? path.join(process.env.USERPROFILE, 'Documents', 'EasyEDA-Pro', 'projects', 'BOMCheck_3.2_UI_验收.eprj2')
			: path.join(process.env.PROGRAMDATA, 'BOMCheckClients', '4.1-test-project', 'BOMCheck_4.1_合并验收.eprj2');
		run('python', [
			'tests/native-file.py',
			'--handle',
			handle,
			'--file',
			file,
			'--dialog-only',
		]);
		await evaluate(await fs.readFile('tests/fixtures/open-extension-menu.js', 'utf8'), 'about-menu', 'root');
		await evaluate(`document.querySelector('[data-test="插件信息"]').click();true`, 'about-open', 'root');
		const about = await evaluate(`(()=>{const text=document.body.innerText;return text.slice(text.lastIndexOf('关于物料核对'));})()`, 'about', 'root');
		assert.ok(about.includes('物料核对 BOMCheck 1.0.0'));
		assert.ok(about.includes('网站：https://www.klaio.top/'));
		await screenshot('about');
		await evaluate(`[...document.querySelectorAll('button')].find(e=>e.textContent==='关闭说明'&&e.getClientRects().length).click();true`, 'about-close', 'root');
		await evaluate(await fs.readFile('tests/fixtures/open-extension-menu.js', 'utf8'), 'open-menu', 'root');
		await evaluate(`document.querySelector('[data-test="启动核对"]').click();true`, 'open-window', 'root');
		await evaluate(idle, 'ready');
		await fs.writeFile(`${prefix}-smoke.json`, JSON.stringify(await evaluate(await fs.readFile('tests/fixtures/final-smoke.js', 'utf8'), 'smoke'), null, 2), 'utf8');
		console.log(`客户端${label}新包详情、元数据、关于弹窗及加载通过`);
		return;
	}
	await evaluate(idle, 'ready');
	const before = await evaluate(`(async()=>{const p=await eda.dmt_Project.getCurrentProjectInfo();if(!p?.friendlyName.startsWith('BOMCheck_'))throw Error('只允许独立测试工程');const boards=await eda.dmt_Pcb.getAllPcbsInfo();if(boards.length!==1)throw Error('PCB范围不唯一');await eda.dmt_EditorControl.openDocument(boards[0].uuid);if(typeof eda.dmt_EditorControl.waitForDocumentReady==='function')await eda.dmt_EditorControl.waitForDocumentReady(boards[0].uuid,60000);else await new Promise(r=>setTimeout(r,800));return {project:p.friendlyName,version:eda.sys_Environment.getEditorCurrentVersion(),components:(await eda.pcb_PrimitiveComponent.getAll()).map(c=>({id:c.getState_PrimitiveId(),ref:c.getState_Designator(),name:c.getState_Name()}))};})()`, 'before');
	assert.equal(before.components.length, 479);
	// 工程文档就绪后重新读取范围，避免启动窗口时的空工程状态进入测试。
	await evaluate(`(async()=>{${ready}$('tab-file').click();$('refresh').click();await wait(()=>!$('refresh').disabled&&[...$('scope').options].some(o=>o.text.includes(' / PCB / ')));return [...$('scope').options].map(o=>o.text);})()`, 'scope-ready');
	async function save(button, suffix) {
		const filename = path.resolve(`${prefix}-${suffix}`);
		await fs.rm(filename, { force: true });
		await evaluate(`document.getElementById('${button}').click();true`, 'save-click');
		run('python', [
			'tests/native-save.py',
			'--handle',
			handle,
			'--file',
			filename,
			'--dialog-only',
		]);
		await evaluate(idle, 'saved');
		return fs.readFile(filename);
	}
	await evaluate(`document.getElementById('tab-operation').click();true`, 'empty-log-page');
	const empty = JSON.parse(await save('exportRecord', 'empty-operations.json'));
	assert.deepEqual(empty.metadata, jsonExportInfo);
	assert.deepEqual(Object.keys(empty).sort(), ['metadata', 'operation', 'recovery']);
	assert.deepEqual(empty.operation, []);
	async function choose(file) {
		await evaluate(`document.getElementById('tab-file').click();document.getElementById('choose').click();true`, 'choose');
		run('python', [
			'tests/native-file.py',
			'--handle',
			handle,
			'--file',
			file,
			'--dialog-only',
		]);
		await evaluate(idle, 'file-ready');
		assert.equal(await evaluate(`document.getElementById('filename').textContent`, 'filename'), path.basename(file));
	}
	async function check() {
		return evaluate(`(async()=>{${ready}const pcb=[...$('scope').options].find(o=>o.text.includes(' / PCB / '));$('scope').value=pcb.value;$('scope').dispatchEvent(new Event('change'));$('start').click();await wait(()=>!$('refresh').disabled&&$('status').textContent.includes('器件核对已经完成'));return $('summary').textContent;})()`, 'checked');
	}
	const referenceDir = path.join(process.env.USERPROFILE, 'Desktop', '临时');
	const reference = (await fs.readdir(referenceDir, { recursive: true })).find(name => name.includes('0001084') && name.endsWith('.xlsx'));
	assert.ok(reference);
	await choose(path.join(referenceDir, reference));
	const summary = await check();
	const workbook = XLSX.read(await save('export', 'difference.xlsx'), { type: 'buffer' });
	const previous = XLSX.read(await fs.readFile(`tests/output/empty-${label}-difference.xlsx`), { type: 'buffer' });
	assert.deepEqual(workbook.SheetNames, previous.SheetNames);
	for (const sheet of workbook.SheetNames)
		assert.deepEqual(XLSX.utils.sheet_to_json(workbook.Sheets[sheet], { header: 1 }), XLSX.utils.sheet_to_json(previous.Sheets[sheet], { header: 1 }));
	for (const key of [
		'Author',
		'LastAuthor',
		'Company',
		'Keywords',
		'Comments',
	])
		assert.equal(workbook.Props[key], previous.Props[key]);
	assert.deepEqual(workbook.Custprops, previous.Custprops);
	assert.equal(workbook.Props.Keywords, exportInfo.keywords);
	const source = `${prefix}-source.csv`;
	await fs.writeFile(source, '\uFEFF位号,描述\r\nC54,JSON验收\r\n', 'utf8');
	await choose(source);
	await check();
	const original = before.components.find(c => c.ref === 'C54');
	try {
		await evaluate(`(async()=>{${ready}$('tab-mapping').click();$('addMapping').click();const p=$('mappings').firstElementChild;for(const [select,value]of [[p.querySelector('select'),'standard:name'],[p.querySelector('.mapping-source select'),'col:1']]){select.value=value;select.dispatchEvent(new Event('change'));}$('run').click();await wait(()=>!$('refresh').disabled);$('tab-operation').click();return $('status').textContent;})()`, 'write');
		const log = JSON.parse(await save('exportRecord', 'operations.json'));
		assert.deepEqual(log.metadata, jsonExportInfo);
		assert.deepEqual(Object.keys(log).sort(), ['metadata', 'operation', 'recovery']);
		assert.ok(log.operation.some(row => row.目标值 === 'JSON验收' && row.结果 === '成功'));
		assert.ok(log.recovery);
		const name = await evaluate(`(async()=>{const c=(await eda.pcb_PrimitiveComponent.getAll()).find(c=>c.getState_Designator()==='C54');return c.getState_Name();})()`, 'readback');
		assert.equal(name, 'JSON验收');
	}
	finally {
		await evaluate(`(async()=>{const c=${JSON.stringify(original)};if(!await eda.pcb_PrimitiveComponent.modify(c.id,{name:c.name}))throw Error('测试原值恢复失败');await eda.pcb_Document.save();return true;})()`, 'restore');
	}
	const restored = await evaluate(`(async()=>{const c=(await eda.pcb_PrimitiveComponent.getAll()).find(c=>c.getState_Designator()==='C54');return c.getState_Name();})()`, 'restore-read');
	assert.equal(restored, original.name);
	const details = JSON.parse(await fs.readFile(`${prefix}-details.json`, 'utf8'));
	await fs.writeFile(`${prefix}-live.json`, JSON.stringify({
		version: before.version,
		project: before.project,
		details,
		summary,
		jsonEmpty: true,
		jsonWithOperation: true,
		recoveryPreserved: true,
		excelSheetsUnchanged: true,
		excelPropertiesUnchanged: true,
		testValueRestored: true,
	}, null, 2), 'utf8');
	console.log(`客户端${label}JSON空日志与实际操作日志、Excel保持及回读验证通过`);
}
void main();
