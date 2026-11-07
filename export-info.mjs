/**
 * 文件导出身份及 JSON 操作日志结构的集中定义。
 * 身份只从插件元数据读取，原始业务字典不根据看似身份的字段名删改。
 */
import info from './extension-info.json' with { type: 'json' };

/**
 * Excel 文档属性与 ZIP 归档注释使用的身份字段。
 * author、company 等沿用集中作者，地址字段沿用集中主页，版本保持集中定义。
 */
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

/**
 * JSON 日志只发布作者、网站和版本三个身份字段，业务数据不受该筛选影响。
 */
export const jsonExportInfo = Object.freeze({
	author: info.author,
	website: info.homepage,
	version: info.version,
});

/**
 * 组织身份、修改前数据和执行明细，缺少修改前数据时明确写 null。
 * 传入业务对象及数组直接保留引用，不递归过滤 company、metadata 等同名业务键。
 */
export function operationLog(recovery, operation) {
	return { metadata: jsonExportInfo, recovery: recovery ?? null, operation };
}
