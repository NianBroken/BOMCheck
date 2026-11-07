import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import JSZip from 'jszip';
import * as XLSX from 'xlsx';
import { exportInfo, jsonExportInfo } from '../export-info.mjs';
import { withTestOutput } from './test-output.mjs';
/** 在真实客户端验证空状态、来源数量切换、导出属性和实际写入回读。 */
async function main(outputDirectory) {
	const [port, handle, mode = 'empty'] = process.argv.slice(2);
	const label = String(port);
	const prefix = `${outputDirectory}/empty-${label}`;
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
		const output = `${prefix}-${++serial}-${name}.json`;
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
	const ready = `const $=id=>document.getElementById(id);const wait=async test=>{const end=Date.now()+45000;while(!test()){if(Date.now()>end)throw Error('等待界面超时：'+$('status').textContent);await new Promise(r=>setTimeout(r,40));}};`;
	const idle = `(async()=>{${ready}await wait(()=>!$('refresh').disabled);return $('status').textContent;})()`;
	await evaluate(idle, 'ready');
	const read = `(async()=>{const p=await eda.dmt_Project.getCurrentProjectInfo();if(!p.friendlyName.startsWith('BOMCheck_'))throw Error('必须使用独立测试工程');const pcbs=await eda.dmt_Pcb.getAllPcbsInfo();if(pcbs.length!==1)throw Error('PCB范围不唯一');if((await eda.dmt_SelectControl.getCurrentDocumentInfo())?.uuid!==pcbs[0].uuid){await eda.dmt_EditorControl.openDocument(pcbs[0].uuid);if(typeof eda.dmt_EditorControl.waitForDocumentReady==='function')await eda.dmt_EditorControl.waitForDocumentReady(pcbs[0].uuid,60000);else await new Promise(r=>setTimeout(r,800));}return {project:p.friendlyName,version:eda.sys_Environment.getEditorCurrentVersion(),components:(await eda.pcb_PrimitiveComponent.getAll()).map(c=>({id:c.getState_PrimitiveId(),ref:c.getState_Designator(),name:c.getState_Name(),other:c.getState_OtherProperty()}))};})()`;
	const before = await evaluate(read, 'snapshot');
	assert.equal(before.components.length, 479);
	const report = { version: before.version, project: before.project, checks: [] };
	if (mode === 'empty') {
		for (const [width, height] of [
			[1280, 860],
			[1024, 768],
			[640, 480],
		]) {
			const frame = await evaluate(`(()=>{const f=[...document.querySelectorAll('iframe')].find(e=>e.src.startsWith('blob:'));const b=f.parentElement.parentElement,d=b.parentElement;Object.assign(d.style,{position:'fixed',left:'10px',top:'10px',width:'${width}px',height:'${height + 28}px',maxWidth:'none',maxHeight:'none'});Object.assign(b.style,{height:'${height}px',maxHeight:'${height}px'});Object.assign(f.style,{width:'${width}px',height:'${height}px'});return f.getBoundingClientRect().toJSON();})()`, 'size', 'root');
			for (const [tab, id] of [
				['preview', 'preview'],
				['project', 'projectOnly'],
				['bom', 'bomOnly'],
				['mapping', 'writePreview'],
				['issues', 'issues'],
				['operation', 'operation'],
			]) {
				const layout = await evaluate(`(async()=>{${ready}$('tab-${tab}').click();await new Promise(r=>setTimeout(r,120));const t=$('${id}'),s=t.querySelector('.table-empty-state'),h=t.querySelector('.tabulator-header');return {size:[innerWidth,innerHeight],table:t.getBoundingClientRect().toJSON(),card:s.getBoundingClientRect().toJSON(),title:s.querySelector('.table-empty-title').textContent,description:s.querySelector('.table-empty-description').textContent,headerHidden:getComputedStyle(h).display==='none',overflow:document.documentElement.scrollWidth>innerWidth,previewSummaryHidden:$('previewState').hidden};})()`, 'layout');
				assert.deepEqual(layout.size, [width, height]);
				assert.equal(layout.headerHidden, true);
				assert.equal(layout.overflow, false);
				assert.ok(layout.table.height >= 112 && layout.table.height < 190);
				assert.ok(layout.card.width <= layout.table.width);
				assert.equal(layout.previewSummaryHidden, true);
				report.checks.push({
					width,
					height,
					tab,
					title: layout.title,
					heightActual: layout.table.height,
				});
				if (tab === 'preview' || width === 1024) {
					await evaluate('true', `shot-${tab}`, 'ui', {
						BOMCHECK_SCREENSHOT: `${outputDirectory}/screenshots/empty-after-${label}-${tab}-${width}x${height}.png`,
						BOMCHECK_CLIP: JSON.stringify({
							x: frame.x,
							y: frame.y,
							width,
							height,
							scale: 1,
						}),
					});
				}
			}
		}
		await fs.writeFile(`${prefix}-layout.json`, JSON.stringify(report, null, 2), 'utf8');
		console.log(`客户端${label}六类空状态与三种尺寸通过`);
		return;
	}
	async function choose(file) {
		await evaluate('document.getElementById("tab-file").click();document.getElementById("choose").click();true', 'file-page');
		run('python', [
			'tests/native-file.py',
			'--handle',
			handle,
			'--file',
			file,
			'--dialog-only',
		]);
		await evaluate(idle, 'file-loaded');
		assert.equal(await evaluate('document.getElementById("filename").textContent', 'filename'), path.basename(file));
	}
	async function check() {
		return evaluate(`(async()=>{${ready}const pcb=[...$('scope').options].find(o=>o.text.includes(' / PCB / '));if(!pcb)throw Error('没有PCB处理范围');if($('scope').value!==pcb.value){$('scope').value=pcb.value;$('scope').dispatchEvent(new Event('change'));}await wait(()=>!$('start').disabled);$('start').click();await wait(()=>!$('refresh').disabled&&$('status').textContent.includes('器件核对已经完成'));return $('summary').textContent;})()`, 'checked');
	}
	if (mode === 'states') {
		report.states = [];
		for (const [suffix, content, kind, title] of [
			[
				'manual.csv',
				'编码,说明\nR1,测试\n',
				'idle',
				'等待确定位号',
			],
			[
				'empty.csv',
				'位号,说明\n,\n',
				'empty',
				'没有有效器件',
			],
			[
				'broken.xlsx',
				'PK\u0003\u0004truncated-workbook',
				'error',
				'清单读取失败',
			],
		]) {
			const file = `${prefix}-${suffix}`;
			await fs.writeFile(file, content, 'utf8');
			await choose(file);
			const actual = await evaluate(`(async()=>{${ready}$('tab-preview').click();await new Promise(r=>setTimeout(r,120));const s=$('preview').querySelector('.table-empty-state');return {kind:s.dataset.kind,title:s.querySelector('.table-empty-title').textContent,summaryHidden:$('previewState').hidden};})()`, 'state');
			assert.equal(actual.kind, kind);
			assert.equal(actual.title, title);
			assert.equal(actual.summaryHidden, true);
			report.states.push(actual);
		}
		await fs.writeFile(`${prefix}-states.json`, JSON.stringify(report, null, 2), 'utf8');
		console.log(`客户端${label}配置待定、有效空结果和读取失败状态通过`);
		return;
	}
	const referenceFiles = [];
	async function findReference(directory) {
		for (const item of await fs.readdir(directory, { withFileTypes: true })) {
			const full = path.join(directory, item.name);
			if (item.isDirectory())
				await findReference(full);
			else if (item.name.endsWith('.xlsx') && !item.name.startsWith('~$'))
				referenceFiles.push(full);
		}
	}
	assert.ok(process.env.BOMCHECK_REFERENCE_DIR, '请设置BOMCHECK_REFERENCE_DIR为参考文件目录');
	await findReference(process.env.BOMCHECK_REFERENCE_DIR);
	assert.equal(referenceFiles.length, 3);
	const baseline = {
		fullPreview: referenceFiles.sort().map(file => ({ file })),
	};
	report.baselines = [];
	for (const entry of baseline.fullPreview) {
		await choose(entry.file);
		const summary = await check();
		await evaluate('document.getElementById("tab-preview").click();true', 'preview-page');
		run('python', [
			'tests/desktop.py',
			'shot',
			'--handle',
			handle,
			'--path',
			`${outputDirectory}/screenshots/empty-after-data-${label}-${report.baselines.length}-top.png`,
		]);
		await evaluate(`(async()=>{const h=document.querySelector('#preview .tabulator-tableholder');h.scrollTop=0;await new Promise(r=>setTimeout(r,150));h.scrollTop=h.scrollHeight;await new Promise(r=>setTimeout(r,300));return true;})()`, 'scroll-last');
		run('python', [
			'tests/desktop.py',
			'shot',
			'--handle',
			handle,
			'--path',
			`${outputDirectory}/screenshots/empty-after-data-${label}-${report.baselines.length}-last.png`,
		]);
		const preview = await evaluate(`(()=>({summary:document.getElementById('previewState').textContent,hidden:document.getElementById('previewState').hidden,last:document.querySelector('#preview .tabulator-row:last-child').textContent}))()`, 'full-preview');
		assert.equal(preview.hidden, false);
		assert.ok(preview.summary.includes(entry.file.includes('0001084')
			? '481'
			: '480'));
		assert.ok(preview.last.includes('C339'));
		report.baselines.push({
			file: path.basename(entry.file),
			summary,
			preview: preview.summary,
			lastAccessible: true,
		});
	}
	const filters = await evaluate(`(async()=>{${ready}const table=$('preview').querySelector('.tabulator-table'),f=$('preview').querySelector('.tabulator-header-filter input');f.value='不存在的器件记录';f.dispatchEvent(new KeyboardEvent('keyup',{key:'x',bubbles:true}));await new Promise(r=>setTimeout(r,450));const result={header:getComputedStyle($('preview').querySelector('.tabulator-header')).display,empty:$('preview').innerText.includes('没有匹配记录')};$('tab-issues').click();$('tab-preview').click();await new Promise(r=>setTimeout(r,100));result.same=table===$('preview').querySelector('.tabulator-table')&&f.value==='不存在的器件记录';f.value='';f.dispatchEvent(new KeyboardEvent('keyup',{key:'x',bubbles:true}));return result;})()`, 'filters');
	assert.notEqual(filters.header, 'none');
	assert.equal(filters.empty, true);
	assert.equal(filters.same, true);
	report.filters = filters;
	await evaluate('document.getElementById("tab-file").click();true', 'export-page');
	const xlsx = path.resolve(`${prefix}-difference.xlsx`);
	await fs.rm(xlsx, { force: true });
	await evaluate('document.getElementById("export").click();true', 'export-click');
	run('python', [
		'tests/native-save.py',
		'--handle',
		handle,
		'--button',
		'export',
		'--file',
		xlsx,
		'--dialog-only',
	]);
	await evaluate(idle, 'saved-xlsx');
	const bytes = await fs.readFile(xlsx);
	const book = XLSX.read(bytes, { type: 'buffer' });
	const zip = await JSZip.loadAsync(bytes);
	for (const [key, value] of Object.entries({
		Author: exportInfo.author,
		LastAuthor: exportInfo.author,
		Company: exportInfo.company,
		Keywords: exportInfo.keywords,
		Comments: exportInfo.comments,
	}))
		assert.equal(book.Props[key], value, key);
	assert.deepEqual(book.Custprops, { Copyright: exportInfo.copyright, Website: exportInfo.website, Link: exportInfo.link });
	assert.equal(book.Sheets[book.SheetNames[0]].A1.v, '当前工作表没有有效数据。');
	assert.equal(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[1]]).length, 2);
	const core = await zip.file('docProps/core.xml').async('string');
	const app = await zip.file('docProps/app.xml').async('string');
	assert.ok(core.includes('<dc:description>https://www.klaio.top/</dc:description>'));
	assert.ok(core.includes('<cp:keywords>NianBroken</cp:keywords>'));
	assert.ok(app.includes('<Company>NianBroken</Company>'));
	report.metadata = book.Props;
	const csv = `${prefix}-source.csv`;
	await fs.writeFile(csv, '\uFEFF位号,代号,描述\r\nC54,001,甲\r\n', 'utf8');
	await choose(csv);
	await check();
	const sourceChecks = await evaluate(`(async()=>{${ready}$('tab-mapping').click();$('addMapping').click();const p=()=>$('mappings').firstElementChild;const set=(e,v)=>{e.value=v;e.dispatchEvent(new Event('change'));};set(p().querySelector('select'),'standard:name');set(p().querySelector('.mapping-source select'),'col:1');const a={singleHidden:!p().querySelector('textarea')};p().querySelector('[data-action=addSource]').click();set(p().querySelectorAll('.mapping-source select')[1],'col:2');let t=p().querySelector('textarea');a.multiShown=!!t;t.value='|';t.dispatchEvent(new Event('input'));p().querySelectorAll('[data-action=removeSource]')[1].click();a.singleHiddenAgain=!p().querySelector('textarea');p().querySelector('[data-action=addSource]').click();set(p().querySelectorAll('.mapping-source select')[1],'col:2');a.draft=p().querySelector('textarea').value;p().querySelector('textarea').value='\\n';p().querySelector('textarea').dispatchEvent(new Event('input'));p().querySelectorAll('[data-action=removeSource]')[1].click();$('previewWritesButton').click();await wait(()=>!$('refresh').disabled);a.singlePreview=$('status').textContent;a.singleValue=$('writePreview').textContent;return a;})()`, 'source-count');
	assert.ok(sourceChecks.singleHidden && sourceChecks.multiShown && sourceChecks.singleHiddenAgain);
	assert.equal(sourceChecks.draft, '|');
	assert.ok(sourceChecks.singlePreview.includes('有效器件 1'));
	report.sourceChecks = sourceChecks;
	// 单列直接填写，多列替换分别核验取消和确认，测试结束恢复独立工程的实际原值。
	const original = before.components.find(c => c.ref === 'C54');
	assert.ok(original);
	async function action(answer) {
		await evaluate('document.getElementById("run").click();true', 'write-click');
		if (answer) {
			await evaluate(`(async()=>{const end=Date.now()+15000;let button;while(!(button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(answer)}&&b.getClientRects().length))){if(Date.now()>end)throw Error('确认窗口未就绪');await new Promise(r=>setTimeout(r,50));}button.click();return true;})()`, 'confirmation', 'root');
		}
		await evaluate(idle, 'write-ended');
	}
	try {
		await action();
		assert.equal((await evaluate(read, 'single-written')).components.find(c => c.ref === 'C54').name, '001');
		await check();
		await evaluate(`(()=>{const p=()=>document.querySelector('.mapping');p().querySelector('[data-action=addSource]').click();const s=p().querySelectorAll('.mapping-source select')[1];s.value='col:2';s.dispatchEvent(new Event('change'));const t=p().querySelector('textarea');t.value='::';t.dispatchEvent(new Event('input'));return true;})()`, 'multi-mapping');
		await action('放弃写入');
		assert.equal((await evaluate(read, 'cancel-read')).components.find(c => c.ref === 'C54').name, '001');
		await check();
		await action('确认写入');
		assert.equal((await evaluate(read, 'multi-written')).components.find(c => c.ref === 'C54').name, '001::甲');
		await evaluate('document.getElementById("tab-operation").click();true', 'log-page');
		const json = path.resolve(`${prefix}-operations.json`);
		await fs.rm(json, { force: true });
		await evaluate('document.getElementById("exportRecord").click();true', 'log-export-click');
		run('python', [
			'tests/native-save.py',
			'--handle',
			handle,
			'--button',
			'exportRecord',
			'--file',
			json,
			'--dialog-only',
		]);
		await evaluate(idle, 'saved-json');
		const log = JSON.parse(await fs.readFile(json, 'utf8'));
		assert.deepEqual(log.metadata, jsonExportInfo);
		assert.ok(log.operation.some(r => r.目标值 === '001::甲'));
		report.write = {
			cancelUnchanged: true,
			single: '001',
			multiple: '001::甲',
			logMetadata: true,
		};
	}
	finally {
		await evaluate(`(async()=>{const c=${JSON.stringify(original)};if(!await eda.pcb_PrimitiveComponent.modify(c.id,{name:c.name}))throw Error('原值恢复失败');await eda.pcb_Document.save();return true;})()`, 'restore');
	}
	assert.equal((await evaluate(read, 'restored')).components.find(c => c.ref === 'C54').name, original.name);
	await fs.writeFile(`${prefix}-data.json`, JSON.stringify(report, null, 2), 'utf8');
	console.log(`客户端${label}完整预览、来源切换、实际写入与导出属性通过`);
}
void withTestOutput(main);
