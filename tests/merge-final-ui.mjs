import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import process from 'node:process';

/** 最终包导入后复查窄窗口映射和原生取消行为，并保留真实截图。 */
async function main() {
	const [port, handle] = process.argv.slice(2);
	const label = port === '9224'
		? '32'
		: '41';
	function run(command, args) {
		const result = spawnSync(command, args, { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr || result.stdout);
	}
	async function evaluate(code, name, scope = 'ui') {
		const file = `tests/output/merge-final-${label}-current.js`;
		const output = `tests/output/merge-final-${label}-${name}.json`;
		await fs.writeFile(file, code, 'utf8');
		run(process.execPath, [
			'tests/ui-client.mjs',
			port,
			file,
			output,
			scope,
		]);
		return JSON.parse(await fs.readFile(output, 'utf8')).result.result.value;
	}
	const baseline = JSON.parse(await fs.readFile('tests/output/merge-32-baselines.json', 'utf8'));
	const file = baseline.fullPreview[0].file;
	await evaluate('document.getElementById("tab-file").click();true', 'initial-file-page');
	run('python', [
		'tests/native-file.py',
		'--handle',
		handle,
		'--file',
		file,
	]);
	await evaluate(await fs.readFile('tests/fixtures/merge-check-current.js', 'utf8'), 'checked');
	await evaluate(await fs.readFile('tests/fixtures/merge-map-layout.js', 'utf8'), 'mapping');
	const before = await evaluate('({filename:document.getElementById("filename").textContent,mappings:document.getElementById("mappings").textContent})', 'before-cancel');
	await evaluate('document.getElementById("tab-file").click();true', 'choose-cancel');
	run('python', [
		'tests/native-file.py',
		'--handle',
		handle,
	]);
	const after = await evaluate('(async()=>{while(document.getElementById("refresh").disabled)await new Promise(r=>setTimeout(r,40));return {filename:document.getElementById("filename").textContent,mappings:document.getElementById("mappings").textContent};})()', 'after-cancel');
	assert.deepEqual(after, before);
	run(process.execPath, ['tests/mapping-layout.mjs', port]);
	await evaluate(`(()=>{const p=document.getElementById('panel-mapping');p.scrollTop=p.querySelector('.mapping-source').offsetTop-40;return true;})()`, 'scroll-sources');
	// 下拉框必须占满来源列，序号所在的窄列不能承担来源选择控件。
	const geometry = await evaluate(`(()=>{const row=document.querySelector('.mapping-source'),select=row.querySelector('select');return {row:row.getBoundingClientRect().toJSON(),select:select.getBoundingClientRect().toJSON()};})()`, 'source-width');
	assert.ok(geometry.select.width > 120);
	run('python', [
		'tests/desktop.py',
		'shot',
		'--handle',
		handle,
		'--path',
		`tests/output/screenshots/merge-final-mapping${label}.png`,
	]);
	await evaluate('document.getElementById("tab-preview").click();true', 'preview-page');
	await evaluate('(async()=>{await new Promise(r=>setTimeout(r,100));const h=document.querySelector("#preview .tabulator-tableholder");h.scrollTop=h.scrollHeight;await new Promise(r=>setTimeout(r,100));return document.getElementById("previewState").textContent;})()', 'preview-last');
	run('python', [
		'tests/desktop.py',
		'shot',
		'--handle',
		handle,
		'--path',
		`tests/output/screenshots/merge-final-preview${label}.png`,
	]);
	await evaluate('setTimeout(()=>eda.sys_IFrame.closeIFrame("bomcheck-main"),30);true', 'close-about');
	await evaluate(await fs.readFile('tests/fixtures/open-extension-menu.js', 'utf8'), 'about-menu', 'root');
	await evaluate('document.querySelector(\'[data-test="插件信息"]\').click();true', 'about-open', 'root');
	const about = await evaluate('(()=>{const t=document.body.innerText;return t.slice(t.lastIndexOf("关于物料核对"));})()', 'about-content', 'root');
	assert.ok(about.includes('网站：https://www.klaio.top/'));
	assert.ok(!about.includes('依据器件位号'));
	assert.ok(about.includes('关闭说明'));
	run('python', [
		'tests/desktop.py',
		'shot',
		'--handle',
		handle,
		'--path',
		`tests/output/screenshots/merge-final-about${label}.png`,
	]);
	run('python', [
		'tests/desktop.py',
		'click',
		'--handle',
		handle,
		'--name',
		'关闭说明',
		'--kind',
		'Button',
	]);
	await fs.writeFile(`tests/output/merge-final-ui${label}.json`, JSON.stringify({
		cancelPreserved: true,
		sourceWidth: geometry.select.width,
		aboutVerified: true,
		sizes: [640, 1024, 1280],
	}, null, 2), 'utf8');
	console.log(`客户端 ${label} 最终界面与取消选择核验通过`);
}
void main();
