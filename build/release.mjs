/**
 * 正式构建入口，将宿主脚本和界面脚本分别编译，再生成自包含页面及可导入扩展。
 * 集中元数据先同步，打包后立即对实际归档逐项核验，最后为同一字节内容生成校验和。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';
import { messages } from '../src/messages.ts';
import commands from '../ui/commands.json' with { type: 'json' };
import pages from '../ui/pages.json' with { type: 'json' };
import { packageName, synchronizeMetadata } from './metadata.mjs';
import { renderTemplate } from './template.mjs';
import { packageExtension } from './utils.ts';
import { verifyPackage } from './verify-package.mjs';

/**
 * 从模块位置解析项目根目录，创建输出目录并同步固定版本身份。
 * 两份互不依赖的脚本并行编译，资源写入和归档检查按实际依赖顺序进行。
 */
async function main() {
	/** 构建只读取系统依赖，内联页面包含完整运行资源，避免宿主递归加载资源的限制。 */
	const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
	process.chdir(root);
	await synchronizeMetadata();
	const metadata = JSON.parse(await fs.readFile('extension.json', 'utf8'));
	await fs.mkdir('build/dist', { recursive: true });
	await fs.mkdir('iframe', { recursive: true });

	/**
	 * 宿主入口编译为提供固定导出对象的自执行脚本；界面入口压缩为浏览器自执行脚本。
	 * 构建先返回内存结果，使用 es2020 目标且不保留库的特殊法律注释块。
	 */
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
	/**
	 * 按表格库、覆盖滚动条库、项目样式顺序组合 CSS，项目规则可覆盖前面的库默认值。
	 */
	const css = `${await fs.readFile('node_modules/tabulator-tables/dist/css/tabulator.min.css', 'utf8')}\n${await fs.readFile('node_modules/overlayscrollbars/styles/overlayscrollbars.css', 'utf8')}\n${await fs.readFile('ui/style.css', 'utf8')}`;
	/**
	 * 导航按页面定义顺序生成，首项选中，其他标签暂不进入普通 Tab 键焦点顺序。
	 */
	const navigation = pages.map((page, index) => `<button id="tab-${page.id}" role="tab" aria-controls="panel-${page.id}" aria-selected="${index === 0}"${index ? ' tabindex="-1"' : ''}>${page.title}</button>`).join('\n');
	/**
	 * 所有中文模板标记由共享渲染器替换，脚本和样式直接内嵌，宿主无需再递归加载页面资源。
	 */
	const html = renderTemplate(await fs.readFile('ui/index.html', 'utf8'), {
		title: metadata.displayName,
		navigation,
		pages,
		commands,
		messages,
		css,
		script: outputs[1].outputFiles[0].text,
	});
	await fs.writeFile('iframe/index.html', html, 'utf8');
	/**
	 * 根据集中身份生成安装包路径，归档写入完成后校验内容，再计算实际字节的 SHA-256。
	 */
	const output = path.join(root, 'build/dist', packageName);
	await packageExtension(root, output);
	const bytes = await fs.readFile(output);
	const { sha256: hash } = await verifyPackage(bytes);
	await fs.writeFile(`${output}.sha256`, `${hash}  ${path.basename(output)}\n`, 'utf8');
	console.log(`扩展打包完成：${output}\nSHA-256：${hash}`);
}

void main();
