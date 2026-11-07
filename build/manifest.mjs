/**
 * 集中校验发布清单的身份、固定版本、许可证和仓库地址。
 * 校验只读取传入对象，不连接网络，不依赖本机 Git 配置。
 */
import assert from 'node:assert/strict';

/**
 * 这些发布字段必须是非空且没有首尾空白的字符串，后续规则再检查其格式。
 */
const requiredText = [
	'name',
	'uuid',
	'displayName',
	'description',
	'version',
	'license',
];
/**
 * 宿主支持的仓库类型名称集合，按原始键精确检查，不在校验时自动猜测类型。
 */
const repositoryTypes = new Set([
	'extension-store',
	'git',
	'mercurial',
	'svn',
	'ftp',
	'github',
	'gitlab',
	'gitlab-selfhosted',
	'gitee',
	'gitea',
	'bitbucket',
	'coding',
	'gnu-savannah',
	'gitbucket',
	'gogs',
]);

/**
 * 拒绝非对象及数组清单，逐项检查必需字段后核对名称、UUID、版本和许可证。
 * 发布版本必须为 1.0.0；仓库必须为完整 HTTPS 地址且指向具体仓库。
 * 断言失败会中止调用方构建，避免生成身份不完整的安装包。
 */
export function validateManifest(manifest) {
	assert.ok(manifest && typeof manifest === 'object' && !Array.isArray(manifest), '扩展清单必须是对象');
	for (const key of requiredText) {
		assert.equal(typeof manifest[key], 'string', `${key}必须是文本`);
		assert.ok(manifest[key].trim() && manifest[key] === manifest[key].trim(), `${key}不能为空或包含首尾空白`);
	}
	assert.match(manifest.name, /^[a-z0-9-]{5,30}$/u, 'name格式无效');
	assert.match(manifest.uuid, /^[a-f0-9]{32}$/u, 'uuid格式无效');
	assert.notEqual(manifest.uuid, '0'.repeat(32), 'uuid不能是空标识');
	assert.equal(manifest.version, '1.0.0', '发布版本必须是1.0.0');
	assert.equal(manifest.license, 'Apache-2.0', '插件自身许可证必须为Apache-2.0');
	/**
	 * 仓库对象必须具有允许的类型和合法 URL，禁止用户名、密码、查询及片段混入发布地址。
	 * GitHub 类型另要求域名正确，路径恰好包含所有者与仓库名两段。
	 */
	const repository = manifest.repository;
	assert.ok(repository && typeof repository === 'object' && !Array.isArray(repository), 'repository必须是对象');
	assert.ok(repositoryTypes.has(repository.type), 'repository.type无效');
	assert.equal(typeof repository.url, 'string', 'repository.url必须是文本');
	assert.ok(repository.url && repository.url === repository.url.trim(), 'repository.url不能为空或包含首尾空白');
	assert.match(repository.url, /^https:\/\//u, '仓库地址必须是完整HTTPS地址');
	const url = new URL(repository.url);
	assert.equal(url.protocol, 'https:', '仓库地址必须使用HTTPS');
	assert.ok(url.hostname.includes('.') && url.pathname.split('/').some(Boolean), '仓库地址必须指向具体仓库');
	assert.ok(!url.username && !url.password && !url.search && !url.hash, '仓库地址不能包含凭据、查询或片段');
	if (repository.type === 'github') {
		assert.equal(url.hostname, 'github.com');
		assert.equal(url.pathname.split('/').filter(Boolean).length, 2, 'GitHub地址必须包含所有者和仓库名');
	}
}
