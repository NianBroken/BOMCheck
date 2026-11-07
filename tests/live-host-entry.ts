/** 客户端联调只携带工程操作模块，表格解析在测试端执行，避免超过宿主脚本容量。 */
export { compare, planWrites } from '../src/compare';
export { EdaHost } from '../src/host';
export { executeDelete, executeWrites } from '../src/operations';
export { targetFields } from '../src/rules';
