import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import process from 'node:process';
import pages from '../ui/pages.json' with { type: 'json' };
import { withTestOutput } from './test-output.mjs';

/** 客户端内调整真实窗口的内容尺寸，逐项核对布局并截取编辑器实际渲染结果。 */
async function main(outputDirectory) {
	const port = process.argv[2];
	const label = String(port);
	const output = outputDirectory;
	const prefix = process.argv[3] ?? 'layout';
	const page = process.argv[4] ?? 'file';
	assert.ok(pages.some(item => item.id === page), '页面标识无效');
	const sizes = [
		[640, 480],
		[1024, 768],
		[1280, 860],
	];
	const reports = [];
	function run(source, destination, scope, extra = {}) {
		const result = spawnSync(process.execPath, [
			'tests/ui-client.mjs',
			port,
			source,
			destination,
			scope,
		], {
			encoding: 'utf8',
			env: {
				...process.env,
				...extra,
			},
		});
		assert.equal(result.status, 0, result.stderr);
	}
	for (const [width, height] of sizes) {
		const source = `${output}/layout-size-current.js`;
		await fs.writeFile(source, `(()=>{const f=[...document.querySelectorAll('iframe')].find(e=>e.src.startsWith('blob:'));const b=f.parentElement.parentElement,d=b.parentElement;Object.assign(d.style,{position:'fixed',left:'10px',top:'10px',width:'${width}px',height:'${height + 28}px',maxWidth:'none',maxHeight:'none'});Object.assign(b.style,{height:'${height}px',maxHeight:'${height}px'});Object.assign(f.style,{width:'${width}px',height:'${height}px'});return f.getBoundingClientRect().toJSON();})()`, 'utf8');
		const resize = `${output}/layout-size-${label}-${width}.json`;
		run(source, resize, 'root');
		const frame = JSON.parse(await fs.readFile(resize, 'utf8')).result.result.value;
		await fs.writeFile(source, `document.activeElement.blur();document.getElementById('panel-${page}').scrollTop=0;document.getElementById('tab-${page}').click();`, 'utf8');
		run(source, `${output}/layout-top-${label}.json`, 'ui');
		const destination = `${output}/layout-${label}-${width}.json`;
		run('tests/fixtures/layout-inspect.js', destination, 'ui', {
			BOMCHECK_SCREENSHOT: `${output}/screenshots/${prefix}-${label}-${width}x${height}.png`,
			BOMCHECK_CLIP: JSON.stringify({
				x: frame.x,
				y: frame.y,
				width,
				height,
				scale: 1,
			}),
		});
		const layout = JSON.parse(await fs.readFile(destination, 'utf8')).result.result.value;
		assert.deepEqual(layout.size, [width, height]);
		assert.equal(layout.pageOverflow, false);
		assert.ok(layout.visible.every(panel => panel.scrollWidth <= panel.width));
		assert.ok(layout.tabs.every(tab => tab.rect.left >= 0 && tab.rect.right <= width));
		assert.equal(layout.visible[0].id, `panel-${page}`);
		if (page === 'file')
			assert.ok(layout.start.top >= 0 && layout.start.bottom <= height);
		reports.push({
			width,
			height,
			pageOverflow: false,
			allTabsReachable: true,
			startVisible: true,
		});
	}
	await fs.writeFile(`${output}/${prefix}-layout-verification-${label}.json`, JSON.stringify(reports, null, 2), 'utf8');
	console.log(JSON.stringify({ port, reports }));
}
void withTestOutput(main);
