/**
 * 供测试打包器使用的业务重导出入口。
 * 只暴露实际解析、清单构造、比较和导出函数，不创建界面及真实宿主对象。
 */
export { buildBom, exportTables, loadWorkbook, readWorkbook } from '../src/bom';
export { compare } from '../src/compare';
