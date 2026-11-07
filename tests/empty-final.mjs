import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import process from 'node:process';

/** 通过实际客户端控件核对单列与多列画面，窗口重开后验证最终包的默认状态。 */
async function main() {
	const [port, handle] = process.argv.slice(2);
	const label = port === '9224'
		? '32'
		: '41';
	const prefix = `tests/output/empty-final-${label}`;
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
	const ready = `const $=id=>document.getElementById(id);const wait=async test=>{const end=Date.now()+45000;while(!test()){if(Date.now()>end)throw Error('界面状态未就绪');await new Promise(r=>setTimeout(r,40));}};`;
	await evaluate(`(()=>{$('tab-file').click();$('choose').click();return true;function $(id){return document.getElementById(id);}})()`, 'choose');
	run('python', [
		'tests/native-file.py',
		'--handle',
		handle,
		'--file',
		`${prefix.replace('empty-final', 'empty')}-source.csv`,
		'--dialog-only',
	]);
	await evaluate(`(async()=>{${ready}await wait(()=>!$('refresh').disabled);const pcb=[...$('scope').options].find(o=>o.text.includes(' / PCB / '));$('scope').value=pcb.value;$('scope').dispatchEvent(new Event('change'));$('start').click();await wait(()=>!$('refresh').disabled&&$('status').textContent.includes('器件核对已经完成'));$('tab-mapping').click();$('addMapping').click();const p=$('mappings').firstElementChild,s=p.querySelector('.mapping-source select');s.value='col:1';s.dispatchEvent(new Event('change'));return true;})()`, 'mapping');
	const frame = await evaluate(`(()=>{const f=[...document.querySelectorAll('iframe')].find(e=>e.src.startsWith('blob:'));const b=f.parentElement.parentElement,d=b.parentElement;Object.assign(d.style,{position:'fixed',left:'10px',top:'10px',width:'1024px',height:'796px',maxWidth:'none',maxHeight:'none'});Object.assign(b.style,{height:'768px',maxHeight:'768px'});Object.assign(f.style,{width:'1024px',height:'768px'});return f.getBoundingClientRect().toJSON();})()`, 'size', 'root');
	for (const kind of ['single', 'multiple']) {
		if (kind === 'multiple')
			await evaluate(`document.querySelector('[data-action=addSource]').click();true`, 'add-source');
		const shown = await evaluate('!!document.querySelector(".mapping textarea")', 'separator-visible');
		assert.equal(shown, kind === 'multiple');
		await evaluate('true', `screenshot-${kind}`, 'ui', {
			BOMCHECK_SCREENSHOT: `tests/output/screenshots/empty-after-sources-${label}-${kind}.png`,
			BOMCHECK_CLIP: JSON.stringify({
				x: frame.x,
				y: frame.y,
				width: 1024,
				height: 768,
				scale: 1,
			}),
		});
	}
	await evaluate('setTimeout(()=>eda.sys_IFrame.closeIFrame("bomcheck-main"),30);true', 'close');
	await evaluate('(async()=>{while(document.querySelector("iframe[src^=blob]"))await new Promise(r=>setTimeout(r,40));return true;})()', 'closed', 'root');
	await evaluate(await fs.readFile('tests/fixtures/open-extension-menu.js', 'utf8'), 'menu', 'root');
	await evaluate('document.querySelector(\'[data-test="启动核对"]\').click();true', 'open', 'root');
	await evaluate(`(async()=>{${ready}await wait(()=>!$('refresh').disabled);return true;})()`, 'ready');
	const smoke = await evaluate(await fs.readFile('tests/fixtures/final-smoke.js', 'utf8'), 'smoke');
	assert.equal(smoke.defaultFilePage, true);
	assert.equal(smoke.ignoreCase, true);
	assert.equal(smoke.visiblePanels, 1);
	assert.deepEqual(smoke.separators, [',', '，', '、']);
	await fs.writeFile(`tests/output/empty-${label}-smoke.json`, JSON.stringify(smoke, null, 2), 'utf8');
	console.log(`客户端${label}来源条件截图、菜单重开与最终运行脚本核验通过`);
}
void main();
