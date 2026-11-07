/**
 * 界面和宿主入口读取同一份插件身份数据。
 * 此模块重导出集中定义，窗口标题、关于信息和导出名称按对应调用处使用。
 */
import info from '../extension-info.json';

/** 窗口、导出和关于信息读取同一身份定义，页面正文不展示扩展品牌说明。 */
export const extensionInfo = Object.freeze(info);
