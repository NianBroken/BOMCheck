/**
 * 安装包运行文件的唯一目录清单，归档生成与校验共同使用。
 * 只发布宿主清单、宿主脚本、内嵌界面及图标，源码、测试和开发依赖不进入归档。
 */
/**
 * 这些相对路径均以项目根目录为基准，数组冻结防止调用方在运行中改动文件集合。
 */
export const runtimeFiles = Object.freeze([
	'extension.json',
	'dist/index.js',
	'iframe/index.html',
	'images/logo.png',
]);
