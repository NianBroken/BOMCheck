/**
 * 从集中身份 JSON 派生宿主扩展清单、软件包身份和固定版本安装包名称。
 * 同一模块提供检查与生成模式，其他构建步骤通过它避免各自维护发布身份。
 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import info from '../extension-info.json' with { type: 'json' };
import commands from '../ui/commands.json' with { type: 'json' };
import { validateManifest } from './manifest.mjs';

/**
 * 冻结集中身份的顶层引用，供构建、运行信息和校验共用，不复制另一个身份字典。
 * 冻结不递归处理嵌套对象，调用方只读取身份数据，不应把它当作深层不可变副本。
 */
export const extensionInfo = Object.freeze(info);
/**
 * 按集中名称及版本生成最终 .eext 文件名，不从已有产物推断版本。
 */
export const packageName = `${info.name}_v${info.version}.eext`;
/**
 * 以当前模块位置解析仓库根目录，不要求调用者位于特定用户桌面。
 */
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
/**
 * 首页、原理图、PCB 和空白页共用相同菜单生成规则。
 * 该列表决定发布清单中实际生成的菜单位置，其他宿主页面不会从此处获得菜单。
 */
const menuLocations = ['home', 'sch', 'pcb', 'blank'];

/**
 * 先校验集中身份，再选择宿主清单实际接收的字段。
 * 显示用英文名等自有字段不直接写入宿主清单，作者映射为 publisher。
 * 各菜单位置派生不同标识，但共同注册 openBomCheck 和 about 两个公开函数。
 */
export function extensionManifest() {
	validateManifest(info);
	// 自有展示字段不直接写入宿主清单，清单字段按平台规范明确选择。
	/**
	 * 明确选取需要发布给宿主的身份字段，避免直接扩散集中 JSON 中的自有配置。
	 */
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
	// 共同字段按发布清单要求显式选择，以下派生字段单独映射发布者、图标、问题入口和菜单。
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

/**
 * 检查模式比对对象内容且不写文件，生成模式按统一缩进序列化派生文件。
 * 软件包依赖与命令保留，只有身份字段集中同步；锁文件同步根身份而不改依赖记录。
 * 此函数读取三份派生文件；写入模式只重写 extension.json、package.json 和 package-lock.json。
 */
export async function synchronizeMetadata(check = false) {
	validateManifest(info);
	assert.equal(info.englishName, 'BOMCheck');
	assert.equal(info.version, '1.0.0');
	const packagePath = path.join(root, 'package.json');
	const packageJson = JSON.parse(await fs.readFile(packagePath, 'utf8'));
	/**
	 * 从唯一身份来源筛选软件包公共信息，仓库类型转换为 npm 使用的 git。
	 */
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
	// extension.json 的字段由 extensionManifest 生成，npm 身份则合并到现有 package.json 以保留脚本和依赖。
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
	/**
	 * 只同步锁文件顶层及根软件包的名称、版本和许可证，依赖安装树继续保持锁定。
	 */
	const lockPath = path.join(root, 'package-lock.json');
	const lock = JSON.parse(await fs.readFile(lockPath, 'utf8'));
	// 只触及锁文件根项目身份，不修改 packages 中各依赖的版本、来源或完整性记录。
	lock.name = info.name;
	lock.version = info.version;
	Object.assign(lock.packages[''], { name: info.name, version: info.version, license: info.license });
	generated.push(['package-lock.json', lock]);
	/**
	 * 对每个派生文件进行对象级比较或 UTF-8 写入。检查失败包含具体文件名和重新生成入口。
	 */
	for (const [filename, expected] of generated) {
		const target = path.join(root, filename);
		// 检查模式比较解析后的 JSON 结构，因此只忽略排版差异；生成模式才写出带制表符缩进的 UTF-8 文本。
		if (check)
			assert.deepEqual(JSON.parse(await fs.readFile(target, 'utf8')), expected, `${filename}与集中元数据不一致，请运行node build/metadata.mjs`);
		else
			await fs.writeFile(target, `${JSON.stringify(expected, null, '\t')}\n`, 'utf8');
	}
}

/**
 * 只有作为直接命令入口执行时才同步；被其他模块导入不会自行写入派生文件。
 */
async function main() {
	if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
		await synchronizeMetadata(process.argv.includes('--check'));
		console.log('集中元数据检查通过');
	}
}
void main();
