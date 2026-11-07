/**
 * 安装包运行文件的唯一目录清单，归档生成与校验共同使用。
 * 只发布宿主清单、宿主脚本、内嵌界面及图标，源码、测试和开发依赖不进入归档。
 * 数组中的相对路径均以项目根目录为基准，顺序用于读取输入，校验时按名称比较完整集合。
 * 冻结数组可避免归档生成器或验包器在运行期间意外改变两者共用的文件清单。
 */
export const runtimeFiles = Object.freeze([
	'extension.json',
	'dist/index.js',
	'iframe/index.html',
	'images/logo.png',
]);
