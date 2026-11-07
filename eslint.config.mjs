/**
 * 项目共享代码检查配置，采用现有规则集并维持制表符、单引号和分号风格。
 * 运行源码、测试与构建脚本由检查命令显式传入，发布构建产物和依赖目录由 ignores 排除。
 */
import antfu from '@antfu/eslint-config';

/**
 * 配置 TypeScript 检查与统一排版；console.log、console.warn 和 console.error 可用，其他 console 方法产生告警。
 * build/check.mjs 在 lint 调用时把允许告警数设为零，因此任何告警都会使检查失败。
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
