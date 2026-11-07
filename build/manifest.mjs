import assert from 'node:assert/strict';

const requiredText = [
	'name',
	'uuid',
	'displayName',
	'description',
	'version',
	'license',
];
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

/** 清单与集中元数据共用同一组发布约束，校验不访问网络或Git环境。 */
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
