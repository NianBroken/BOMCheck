import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { messages } from '../src/messages.ts';
import commands from '../ui/commands.json' with { type: 'json' };
import pages from '../ui/pages.json' with { type: 'json' };
import { packageName, synchronizeMetadata } from './metadata.mjs';
import { packageExtension } from './utils.ts';

async function main() {
/** 构建只读取系统依赖，内联页面包含完整运行资源，避免宿主递归加载资源的限制。 */
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	process.chdir(root);
	await synchronizeMetadata();
	const metadata = JSON.parse(await fs.readFile('extension.json', 'utf8'));
	await fs.mkdir('build/dist', { recursive: true });
	await fs.mkdir('iframe', { recursive: true });

	const outputs = await Promise.all([
		esbuild.build({
			entryPoints: ['src/index.ts'],
			bundle: true,
			write: false,
			format: 'iife',
			globalName: 'edaEsbuildExportName',
			platform: 'browser',
			target: 'es2020',
			legalComments: 'none',
		}),
		esbuild.build({
			entryPoints: ['src/ui.ts'],
			bundle: true,
			write: false,
			format: 'iife',
			platform: 'browser',
			target: 'es2020',
			legalComments: 'none',
			minify: true,
		}),
	]);
	await fs.mkdir('dist', { recursive: true });
	await fs.writeFile('dist/index.js', outputs[0].outputFiles[0].text, 'utf8');
	const css = `${await fs.readFile('node_modules/tabulator-tables/dist/css/tabulator.min.css', 'utf8')}\n${await fs.readFile('node_modules/overlayscrollbars/styles/overlayscrollbars.css', 'utf8')}\n${await fs.readFile('ui/style.css', 'utf8')}`;
	const navigation = pages.map((page, index) => `<button id="tab-${page.id}" role="tab" aria-controls="panel-${page.id}" aria-selected="${index === 0}"${index ? ' tabindex="-1"' : ''}>${page.title}</button>`).join('\n');
	const html = (await fs.readFile('ui/index.html', 'utf8')).replace('<!-- APP_TITLE -->', () => metadata.displayName).replace('<!-- PAGE_NAV -->', () => navigation).replace(/<!-- (TITLE|NOTE):([a-z]+) -->/g, (_match, kind, id) => {
		const page = pages.find(page => page.id === id);
		if (!page || !/^\p{Script=Han}{4}$/u.test(page.title))
			throw new Error(`页面定义无效：${id}`);
		return kind === 'TITLE'
			? page.title
			: page.note;
	}).replace(/<!-- COMMAND:([A-Za-z]+) -->/g, (_match, key) => {
		const label = commands[key];
		if (!label || !/^\p{Script=Han}{4}$/u.test(label))
			throw new Error(`按钮定义无效：${key}`);
		return label;
	}).replace(/<!-- MESSAGE:([A-Za-z]+) -->/g, (_match, key) => {
		if (!messages[key])
			throw new Error(`提示定义无效：${key}`);
		return messages[key];
	}).replace('/* APP_CSS */', () => css.replace(/\/\*![\s\S]*?\*\//gu, '')).replace('/* APP_JS */', () => outputs[1].outputFiles[0].text.replaceAll('</script', '<\\/script'));
	await fs.writeFile('iframe/index.html', html, 'utf8');
	const output = path.join(root, 'build/dist', packageName);
	await packageExtension(root, output);
	const bytes = await fs.readFile(output);
	const hash = createHash('sha256').update(bytes).digest('hex');
	await fs.writeFile(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`, 'utf8');
	const manifest = JSON.parse(await fs.readFile('package.json', 'utf8'));
	const packages = {};
	for (const name of Object.keys({
		...manifest.dependencies,
		...manifest.devDependencies,
	})) {
		const installed = JSON.parse(await fs.readFile(path.join('node_modules', name, 'package.json'), 'utf8'));
		packages[name] = installed.version;
	}
	await fs.writeFile('dependency-versions.json', `${JSON.stringify({ sdk: '1.6.29', packages }, null, 2)}\n`, 'utf8');
	console.log(`扩展打包完成：${output}\nSHA-256：${hash}`);
}

void main();
