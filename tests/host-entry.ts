/**
 * 在真实宿主中验证范围读取、取消、写入回读、原值恢复和实际删除。
 * 仅允许名字以 BOMCheck_ 开头的独立工程；删除验收会真实移除单个测试器件。
 * 每个范围都使用当前宿主快照构造最小清单，测试结束后写回每个目标原名称并保存文档，避免把测试值留在工程中。
 */
import type { BomData } from '../src/model';
import type { OperationHost } from '../src/operations';
import { compare, planWrites } from '../src/compare';
import { EdaHost } from '../src/host';
import { executeDelete, executeWrites } from '../src/operations';
import { scalarText, targetFields } from '../src/rules';

/**
 * 先核对工程名称，再逐范围找带位号的目标，构造仅覆盖该位号的测试清单。
 * 写入测试在 finally 恢复原名称，恢复后逐图元再核对；多单元对象跳过删除场景。
 */
export async function runHostChecks(): Promise<Record<string, unknown>> {
	const project = await eda.dmt_Project.getCurrentProjectInfo();
	if (!project?.friendlyName.startsWith('BOMCheck_'))
		throw new Error('宿主验收只允许BOMCheck_开头的独立工程');
	const host = new EdaHost(eda);
	const ranges = await host.scopes();
	const results: Record<string, unknown>[] = [];
	let stage = '读取范围';
	/**
	 * 确认端口自动通过，其他端口实际转发 EdaHost，保存异常附带阶段和范围便于定位。
	 */
	const port: OperationHost = {
		confirm: async () => true,
		assertProject: scope => host.assertProject(scope),
		save: async (scope) => {
			try {
				await host.save(scope);
			}
			catch (error) {
				throw new Error(`${stage}/保存/${scope.id}：${String(error)}`);
			}
		},
		readOne: (scope, item) => host.readOne(scope, item),
		write: (scope, item, changes) => host.write(scope, item, changes),
		remove: (scope, item) => host.remove(scope, item),
		removeMany: (scope, items) => host.removeMany(scope, items),
	};
	/**
	 * 每个范围独立读取快照，空范围只记录数量，不虚构有器件的测试结果。
	 */
	for (const scope of ranges.scopes) {
		// 每个处理范围独立完成读取、写入、恢复和删除，前一范围的图元身份不会用于下一范围。
		stage = `读取${scope.kind}/${scope.id}`;
		const before = await host.readScope(scope);
		const target = before.find(item => item.designator);
		if (!target) {
			results.push({ kind: scope.kind, components: before.length, empty: true });
			continue;
		}
		const selected = before.filter(item => item.designator === target.designator);
		/**
		 * 以文档和图元组成键保存同位号各单元原名称，避免多页同位号互相覆盖原值。
		 */
		const originals = new Map(selected.map(item => [
			`${item.documentId}/${item.id}`,
			scalarText(item.standard.name),
		]));
		const original = scalarText(target.standard.name);
		const expected = `BOMCheck验收${Date.now()}`;
		/**
		 * 单条有效来源只对应选中位号，预期值带当前时间以区分真实执行与旧结果。
		 */
		const bom: BomData = {
			file: '宿主验收.csv',
			sheet: '验收',
			columns: [
				{
					id: 'ref',
					index: 0,
					header: '位号',
					label: '位号',
				},
				{
					id: 'value',
					index: 1,
					header: '名称',
					label: '名称',
				},
			],
			records: [
				{
					designator: target.designator,
					key: target.designator,
					row: 2,
					values: { ref: target.designator, value: expected },
					originalValues: {},
					valid: true,
				},
			],
			issues: [],
			ignoreCase: false,
		};
		const field = targetFields(selected).find(item => item.id === 'standard:name');
		if (!field)
			throw new Error('没有找到名称属性');
		const plan = planWrites(compare(bom, selected), [
			{
				id: 'test',
				fieldId: field.id,
				sources: [
					{ id: 'source', columnId: 'value' },
				],
				separator: '',
			},
		], [field], false);
		/**
		 * 强制构造覆盖确认并选择放弃，随后回读必须与原值相同。
		 */
		const canceled = await executeWrites({
			...port,
			confirm: async () => false,
		}, scope, { ...plan, overwriteCount: 1 }, async () => {}, () => {});
		if (canceled[0]?.结果 !== '已取消' || scalarText((await host.readOne(scope, target)).standard.name) !== original)
			throw new Error('取消写入改变了原值');
		try {
			const rows = await executeWrites(port, scope, plan, async () => {}, () => {});
			if (rows.filter(row => row.结果 === '成功').length !== selected.length || scalarText((await host.readOne(scope, target)).standard.name) !== expected)
				throw new Error(`真实宿主写入回读不一致：${JSON.stringify({ kind: scope.kind, selected, rows })}`);
		}
		finally {
			for (const item of selected) {
				stage = `恢复/${scope.kind}/${item.documentId}/${item.id}`;
				await host.write(scope, await host.readOne(scope, item), [
					{
						field,
						before: expected,
						after: originals.get(`${item.documentId}/${item.id}`)!,
					},
				]);
			}
			await port.save(scope);
		}
		for (const item of selected) {
			const restored = scalarText((await host.readOne(scope, item)).standard.name);
			const expectedOriginal = originals.get(`${item.documentId}/${item.id}`);
			if (restored !== expectedOriginal) {
				throw new Error(`验收原值恢复失败：${JSON.stringify({
					kind: scope.kind,
					id: item.id,
					document: item.documentId,
					expected: expectedOriginal,
					actual: restored,
				})}`);
			}
		}
		if (selected.length > 1) {
			results.push({
				kind: scope.kind,
				components: before.length,
				units: selected.length,
				writeVerified: true,
				originalRestored: true,
				cancelVerified: true,
				removed: 0,
			});
			continue;
		}
		/**
		 * 构造与工程目标不同的清单位号，使仅传入的目标成为工程独有，再验证取消和真实删除。
		 */
		const absent = {
			...bom,
			records: [
				{ ...bom.records[0], designator: 'BOMCheck_absent', key: 'BOMCheck_absent' },
			],
		};
		const difference = compare(absent, [target]);
		const cancelDelete = await executeDelete({
			...port,
			confirm: async () => false,
		}, scope, difference, () => {});
		if (cancelDelete[0]?.结果 !== '已取消')
			throw new Error('取消删除未返回取消结果');
		await host.readOne(scope, target);
		const deleted = await executeDelete(port, scope, difference, () => {});
		const after = await host.readScope(scope);
		if (deleted.filter(row => row.结果 === '删除成功').length !== 1 || after.some(item => item.id === target.id && item.documentId === target.documentId) || after.length !== before.length - 1)
			throw new Error('真实宿主删除范围或回读数量不一致');
		results.push({
			kind: scope.kind,
			components: before.length,
			writeVerified: true,
			originalRestored: true,
			cancelVerified: true,
			removed: 1,
		});
	}
	/**
	 * 至少有一个范围完成写入验证才允许整体通过，全部为空不能构成有效宿主验收。
	 */
	if (!results.some(result => result.writeVerified))
		throw new Error('独立工程中没有可验收器件');
	return {
		version: host.version(),
		project: project.friendlyName,
		results,
	};
}
