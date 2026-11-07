/**
 * 项目共享代码检查配置，采用现有规则集并维持制表符、单引号和分号风格。
 * 构建产物及依赖由 ignores 排除，实际源码、测试和构建脚本由命令入口指定。
 */
import antfu from '@antfu/eslint-config';

/**
 * 启用 TypeScript 检查和统一排版，允许专门的日志输出方法，其余 console 使用产生告警。
 * 正式 lint 命令额外要求零告警，不通过降低日志等级规避检查。
 */
export default antfu({
	stylistic: {
		indent: 'tab',
		quotes: 'single',
		semi: true,
	},

	typescript: true,

	ignores: ['build/dist/', 'coverage/', 'dist/', 'node_modules/', '.eslintcache', 'debug.log'],

	rules: {
		'no-console': ['warn', { allow: ['log', 'warn', 'error'] }],
	},
});
