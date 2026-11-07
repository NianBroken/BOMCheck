import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import * as XLSX from 'xlsx';

/** 在两个实际客户端通过原生文件对话框读取三份BOM，并核对真实导出结果。 */
async function main() {
	const [port, handle, python] = process.argv.slice(2);
	const label = port === '9224'
		? '32'
		: '41';
	const directory = path.join(process.env.USERPROFILE, 'Desktop', '临时');
	const samples = [];
	async function scan(folder) {
		for (const entry of await fs.readdir(folder, { withFileTypes: true })) {
			const full = path.join(folder, entry.name);
			if (entry.isDirectory())
				await scan(full);
			else if (entry.name.endsWith('.xlsx') && !entry.name.startsWith('~$'))
				samples.push(full);
		}
	}
	await scan(directory);
	const records = [];
	function run(command, args) {
		const result = spawnSync(command, args, { encoding: 'utf8' });
		assert.equal(result.status, 0, result.stderr);
	}
	for (const file of samples) {
		const sample = file.includes('0001084')
			? '1084'
			: file.includes('0001053')
				? '1053'
				: '1043';
		const saved = await fs.stat(`tests/output/revised${label}-${sample}.xlsx`).then(() => true, () => false);
		if (!saved) {
			run(python, [
				'tests/native-file.py',
				'--handle',
				handle,
				'--file',
				file,
			]);
			run(process.execPath, [
				'tests/ui-client.mjs',
				port,
				'tests/output/check-await.js',
				`tests/output/revised${label}-check${sample}.json`,
				'ui',
			]);
		}
		const dest = `tests/output/revised${label}-${sample}.xlsx`;
		if (!saved) {
			run(python, [
				'tests/native-save.py',
				'--handle',
				handle,
				'--file',
				dest,
			]);
		}
		const deadline = Date.now() + 10000;
		while (!await fs.stat(dest).then(() => true, (error) => {
			if (error.code === 'ENOENT')
				return false;
			throw error;
		})) {
			if (Date.now() > deadline)
				throw new Error(`导出文件未生成：${dest}`);
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		const workbook = XLSX.read(await fs.readFile(dest), { type: 'buffer' });
		assert.deepEqual(workbook.SheetNames, ['工程有_BOM无', 'BOM有_工程无']);
		const counts = workbook.SheetNames.map(name => XLSX.utils.sheet_to_json(workbook.Sheets[name]).length);
		assert.deepEqual(counts, [
			0,
			sample === '1084'
				? 2
				: 1,
		]);
		records.push({ sample, counts, sheets: workbook.SheetNames });
	}
	await fs.writeFile(`tests/output/revised-baselines${label}.json`, JSON.stringify(records, null, 2), 'utf8');
	console.log(JSON.stringify({ label, records }));
}
void main();
