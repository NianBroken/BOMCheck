/** 原生界面输出与真实编辑器回读数据逐项比对，结果文件保留完整检查数量。 */
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import * as XLSX from 'xlsx';

async function main() {
	const output = 'tests/output';
	const bom = JSON.parse(await fs.readFile(`${output}/live-bom.json`, 'utf8'));
	const json = async name => JSON.parse(await fs.readFile(`${output}/${name}`, 'utf8'));
	const versions = [];
	for (const version of ['3.2', '4.1']) {
		const read = await json(version === '3.2'
			? 'cdp32-persist-read.json'
			: 'ui41-write-read.json');
		const value = version === '3.2'
			? read.result.result.value
			: read.value;
		const actual = new Map(value.components.map(component => [component.ref, component]));
		let verified = 0;
		for (const record of bom.records) {
			const component = actual.get(record.designator);
			if (!component)
				continue;
			assert.equal(component.other.Description, record.values['col:4'], `${version} ${record.designator} 描述`);
			assert.equal(component.supplierId, record.values['col:3'], `${version} ${record.designator} 供应商编号`);
			verified += 2;
		}
		assert.equal(verified, 958);
		const deletion = await json(`${version}_UI_删除记录.json`);
		assert.equal(deletion.operation.length, 303);
		assert.ok(deletion.operation.every(row => row.结果 === '删除成功'));
		if (version === '3.2') {
			const cancelled = (await json('cdp32-overwrite-cancel.json')).result.result.value;
			assert.ok(cancelled.status.includes('已取消'));
			for (const ref of ['C54', 'C55']) {
				assert.equal(cancelled.components.find(component => component.ref === ref).other.Description, actual.get(ref).other.Description);
			}
			const confirmed = (await json('cdp32-overwrite-confirm.json')).result.result.value;
			assert.equal(confirmed.components.find(component => component.ref === 'C54').supplierId, '000001');
			assert.equal(confirmed.components.find(component => component.ref === 'C55').supplierId, '000002');
		}
		else {
			const cancellation = await json(`${version}_UI_取消覆盖记录.json`);
			assert.deepEqual(cancellation.operation.map(row => row.结果), ['已取消']);
			const overwrite = await json(`${version}_UI_覆盖记录.json`);
			assert.equal(overwrite.operation.length, 4);
			assert.ok(overwrite.operation.every(row => row.结果 === '成功'));
		}
		for (const [name, count] of [
			['空值跳过', 0],
			['选择清空', 2],
			['错误隔离', 3],
		]) {
			const record = await json(`${version}_UI_${name}.json`);
			assert.equal(record.operation.length, count, `${version} ${name}`);
			assert.ok(record.operation.every(row => row.结果 === '成功'));
			if (name === '错误隔离') {
				const plan = JSON.parse(record.recovery).plan;
				assert.equal(plan.issues.length, 2);
				assert.ok(!plan.items.find(item => item.component.designator === 'C54').changes.some(change => change.field.key === 'Description'));
			}
		}
		const isolated = await json(`${version}_UI_运行期隔离.json`);
		assert.deepEqual(isolated.operation.map(row => row.结果).sort(), ['失败', '成功'].sort());
		assert.ok(isolated.operation.find(row => row.结果 === '失败').说明.includes('器件身份发生变化'));
		const schematic = await json(`${version}_UI_多单元.json`);
		assert.equal(schematic.operation.length, 2);
		assert.ok(schematic.operation.every(row => row.结果 === '成功'));
		const restarted = await json(`${version}_UI_重启后无需修改.json`);
		assert.equal(restarted.operation.length, 0);
		assert.equal(JSON.parse(restarted.recovery).plan.unchangedCount, 958);
		const finalWorkbook = XLSX.read(await fs.readFile(`${output}/${version}_UI_最终差异.xlsx`), { type: 'buffer' });
		assert.deepEqual(finalWorkbook.SheetNames.map(name => XLSX.utils.sheet_to_json(finalWorkbook.Sheets[name]).length), [0, 1]);
		const persisted = version === '3.2'
			? (await json('cdp32-final-persist-read.json')).result.result.value.components
			: (await json('restart41-read-all.json')).value.snapshots.find(entry => entry.scope.kind === 'pcb' && entry.components.length).components.map(component => ({ ref: component.designator, other: component.other, supplierId: component.standard.supplierId }));
		assert.equal(persisted.length, 479);
		for (const component of persisted) {
			const source = bom.records.find(record => record.designator === component.ref);
			assert.ok(source);
			assert.equal(component.other.Description, source.values['col:4']);
			assert.equal(component.supplierId, source.values['col:3']);
		}
		versions.push({
			version: value.version,
			fieldsVerified: verified,
			componentsBeforeDelete: actual.size,
			deleted: 303,
			persistedAfterDeletion: persisted.length,
			multiPartWrites: schematic.operation.length,
			runtimeIsolation: { failed: 1, succeeded: 1 },
		});
	}
	const exports = [];
	for (const version of ['3.2', '4.1']) {
		for (const number of ['1043', '1053', '1084']) {
			const filename = `${output}/${version}_UI_差异${number}.xlsx`;
			const workbook = XLSX.read(await fs.readFile(filename), { type: 'buffer' });
			assert.deepEqual(workbook.SheetNames, ['工程有_BOM无', 'BOM有_工程无']);
			const counts = workbook.SheetNames.map(name => XLSX.utils.sheet_to_json(workbook.Sheets[name]).length);
			assert.deepEqual(counts, [
				303,
				number === '1084'
					? 2
					: 1,
			]);
			exports.push({ filename, counts });
		}
	}
	assert.equal(exports.length, 6);
	const schRestart = await json('3.2_UI_重启多页无需修改.json');
	assert.equal(schRestart.operation.length, 0);
	assert.equal(JSON.parse(schRestart.recovery).plan.unchangedCount, 2);
	const original = await json('original-final-check.json');
	assert.equal(original.value.count, 782);
	assert.equal(original.value.description, ' ');
	const result = { versions, exports };
	await fs.writeFile(`${output}/native-verification.json`, JSON.stringify(result, null, 2), 'utf8');
	console.log(JSON.stringify(result));

	/** 两个独立位号用于覆盖确认、取消整批与前导零保存的真实界面验收。 */
	await fs.writeFile(`${output}/UI_覆盖验收.csv`, '\uFEFF位号,测试描述,测试编号\r\nC54,界面验收描述甲,000001\r\nC55,界面验收描述乙,000002\r\n', 'utf8');
	await fs.writeFile(`${output}/UI_错误隔离.csv`, '\uFEFF位号,测试描述,测试编号\r\nC54,冲突甲,000003\r\nC54,冲突乙,000003\r\nC55,有效器件描述,000004\r\n,无位号行,000005\r\n', 'utf8');
	await fs.writeFile(`${output}/UI_清空验收.csv`, '\uFEFF位号,测试描述,测试编号\r\nC54,,000001\r\nC55,,000002\r\n', 'utf8');
}

void main();
