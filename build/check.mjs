import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { synchronizeMetadata } from './metadata.mjs';

/** 直接定位已锁定的软件包入口，避免系统PATH中同名旧命令影响检查结果。 */
const tools = {
	typecheck: {
		name: 'typescript',
		bin: 'tsc',
		args: ['--noEmit'],
	},
	lint: {
		name: 'eslint',
		bin: 'eslint',
		args: [
			'src',
			'tests',
			'build',
			'--max-warnings',
			'0',
		],
	},
};
async function main() {
	await synchronizeMetadata(true);
	const selected = tools[process.argv[2]];
	if (!selected)
		throw new Error('请选择typecheck或lint检查');
	const manifestPath = fileURLToPath(import.meta.resolve(`${selected.name}/package.json`));
	const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
	const entry = path.resolve(path.dirname(manifestPath), manifest.bin[selected.bin]);
	const result = spawnSync(process.execPath, [
		entry,
		...selected.args,
		...process.argv.slice(3),
	], { stdio: 'inherit' });
	if (result.error)
		throw result.error;
	process.exitCode = result.status ?? 1;
}
void main();
