/**
 * 供测试打包器使用的业务重导出入口。
 * 只暴露实际解析、清单构造、比较和导出函数，不创建界面及真实宿主对象。
 *
 * 单元测试和参考文件基准都从这个入口取得同一套实现，因此测试不会因为另外复制一份解析逻辑而失去代表性。
 * 这里没有初始化 eda 全局对象，也不打开文件选择框，调用方可以在 Node 测试进程中直接传入内存字节并回读导出结果。
 */
export { buildBom, exportTables, loadWorkbook, readWorkbook } from '../src/bom';
export { compare } from '../src/compare';
