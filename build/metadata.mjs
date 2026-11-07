import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import info from '../extension-info.json' with { type: 'json' };
import commands from '../ui/commands.json' with { type: 'json' };
import { validateManifest } from './manifest.mjs';

/** 身份信息只在extension-info.json定义，宿主清单和包描述均为可验证的生成结果。 */
export const extensionInfo = Object.freeze(info);
export const packageName = `${info.name}_v${info.version}.eext`;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const menuLocations = ['home', 'sch', 'pcb', 'blank'];

/** 菜单位置共享同一生成规则，所有标题和标识与集中元数据保持一致。 */
export function extensionManifest() {
	validateManifest(info);
	// 自有展示字段不直接写入宿主清单，清单字段按平台规范明确选择。
	const keys = [
		'name',
		'uuid',
		'displayName',
		'description',
		'version',
		'homepage',
		'license',
		'repository',
		'engines',
		'categories',
		'entry',
	];
	const common = Object.fromEntries(keys.map(key => [key, info[key]]));
	return {
		...common,
		publisher: info.author,
		keywords: info.keywords,
		images: { logo: info.logo },
		bugs: info.homepage,
		headerMenus: Object.fromEntries(menuLocations.map(location => [
			location,
			[
				{
					id: `${info.name}-${location}`,
					title: info.displayName,
					menuItems: [
						{ id: `${info.name}-open-${location}`, title: commands.openMenu, registerFn: 'openBomCheck' },
						{ id: `${info.name}-about-${location}`, title: commands.aboutMenu, registerFn: 'about' },
					],
				},
			],
		])),
	};
}

/** 检查模式不改写文件，生成模式只同步身份字段并保留软件包依赖及构建命令。 */
export async function synchronizeMetadata(check = false) {
	validateManifest(info);
	assert.equal(info.englishName, 'BOMCheck');
	assert.equal(info.version, '1.0.0');
	const packagePath = path.join(root, 'package.json');
	const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
	const identity = Object.fromEntries([
		'name',
		'version',
		'description',
		'author',
		'license',
		'homepage',
		'keywords',
	].map(key => [key, info[key]]));
	identity.repository = { type: 'git', url: info.repository.url };
	const generated = [
		[
			'extension.json',
			extensionManifest(),
		],
		[
			'package.json',
			{
				...packageJson,
				...identity,
			},
		],
	];
	const lockPath = path.join(root, 'package-lock.json');
	const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
	lock.name = info.name;
	lock.version = info.version;
	Object.assign(lock.packages[''], { name: info.name, version: info.version, license: info.license });
	generated.push(['package-lock.json', lock]);
	for (const [filename, expected] of generated) {
		const target = path.join(root, filename);
		if (check)
			assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), expected, `${filename}与集中元数据不一致，请运行node build/metadata.mjs`);
		else
			await fs.writeFile(target, `${JSON.stringify(expected, null, '\t')}\n`, 'utf8');
	}
}

async function main() {
	if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
		await synchronizeMetadata(process.argv.includes('--check'));
		console.log('集中元数据检查通过');
	}
}
void main();
