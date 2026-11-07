/**
 * 界面和宿主入口读取同一份插件身份数据，避免窗口标题、关于信息与导出名称各自维护副本。
 * 该模块只导入并浅冻结 JSON 对象的顶层属性，不校验字段、不深冻结嵌套对象，也不处理版本转换。
 * 调用处仍按各自用途读取 displayName、author、homepage 等字段，页面正文不在此处生成。
 */
import info from '../extension-info.json';

/**
 * 冻结集中身份对象，阻止调用方替换其顶层字段；嵌套数组和对象仍沿用导入对象本身。
 * 返回值保留 JSON 推导出的字段类型，窗口入口和导出模块据此读取所需身份字段。
 */
export const extensionInfo = Object.freeze(info);
