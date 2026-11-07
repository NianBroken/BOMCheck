import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

/** 对比真实工程快照，核验取消整批、字段对应、前导零和无关属性保留。 */
async function main() {
	const results = [];
	for (const label of ['32', '41']) {
		const read = async name => JSON.parse(await fs.readFile(`tests/output/revised-${name}${label}.json`, 'utf8')).result.result.value;
		const before = await read('before');
		const cancelled = await read('cancelled');
		const after = await read('after');
		assert.deepEqual(cancelled.components, before.components, '取消覆盖后工程不得变化');
		assert.equal(after.components.length, 479);
		let fields = 0;
		for (const original of before.components) {
			const actual = after.components.find(component => component.id === original.id);
			if (['C54', 'C55'].includes(original.ref)) {
				assert.equal(actual.other.Description, original.ref === 'C54'
					? '界面验收描述甲'
					: '界面验收描述乙');
				assert.equal(actual.supplier, original.ref === 'C54'
					? '000001'
					: '000002');
				const { Description: _oldDescription, ...oldOther } = original.other;
				const { Description: _newDescription, ...newOther } = actual.other;
				assert.deepEqual(newOther, oldOther);
				fields += 2;
			}
			else {
				assert.deepEqual(actual, original);
			}
		}
		const operation = await read('operation');
		assert.ok(operation.status.includes('成功 4'));
		assert.ok(operation.operation.includes('成功'));
		results.push({
			label,
			components: 479,
			cancelledUnchanged: true,
			verifiedFields: fields,
			unrelatedPropertiesPreserved: true,
			operation: operation.status,
		});
		const restore = before.components.filter(component => ['C54', 'C55'].includes(component.ref));
		await fs.writeFile(`tests/output/restore-revised${label}.js`, `(async()=>{const originals=${JSON.stringify(restore)};for(const c of originals){if(!await eda.pcb_PrimitiveComponent.modify(c.id,{supplierId:c.supplier,otherProperty:c.other}))throw Error('测试原值恢复失败');}await eda.pcb_Document.save();return {restored:originals.map(c=>c.ref)};})()`, 'utf8');
	}
	await fs.writeFile('tests/output/revised-write-verification.json', JSON.stringify(results, null, 2), 'utf8');
	console.log(JSON.stringify(results));
}
void main();
