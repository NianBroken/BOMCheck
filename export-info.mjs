import info from './extension-info.json' with { type: 'json' };

/** 文件身份只派生自插件元数据，文件格式适配不得各自维护作者和地址。 */
export const exportInfo = Object.freeze({
	author: info.author,
	company: info.author,
	keywords: info.author,
	copyright: info.author,
	website: info.homepage,
	link: info.homepage,
	comments: info.homepage,
	version: info.version,
});

/** JSON日志的基础信息独立筛选，Excel文档属性及归档说明使用完整身份信息。 */
export const jsonExportInfo = Object.freeze({
	author: info.author,
	website: info.homepage,
	version: info.version,
});

/** 业务原值和执行记录直接保留，不按属性名称递归过滤器件数据。 */
export function operationLog(recovery, operation) {
	return { metadata: jsonExportInfo, recovery: recovery ?? null, operation };
}
