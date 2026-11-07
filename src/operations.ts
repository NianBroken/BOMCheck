/**
 * 执行已经计算完成的属性写入和器件删除，记录每个实际处理结果。
 * 操作端口可由真实宿主或测试替身实现，界面筛选不参与修改目标的确定。
 * 单项失败以结果行保存，整批结束后尝试保存范围中的文档。
 */
import type { EdaHost } from './host';
import type { Comparison, ComponentSnapshot, OperationRow, Scope, WritePlan } from './model';
import { isUnambiguousGroup } from './compare';
import { messages, notices } from './messages';
import { DELETE_BATCH_SIZE, errorText, fieldValue, hasVisible, referenceKey, scalarText, YIELD_INTERVAL, yieldUi } from './rules';

/**
 * 批量业务需要的最小宿主能力集合。
 * 数组删除为可选能力；不提供该能力时按单器件删除，其他端口均由调用方提供。
 */
export type OperationHost = Pick<EdaHost, 'confirm' | 'readOne' | 'write' | 'remove' | 'assertProject' | 'save'> & Partial<Pick<EdaHost, 'removeMany'>>;

/**
 * 报告计划内问题，存在覆盖时只请求一次整批确认，取消后不调用写入。
 * 逐器件重新读取身份和字段原值，身份变化隔离整器件，字段值变化仅跳过对应字段。
 * 同器件的有效字段合并提交，再逐字段核对回读值并生成结果。
 * 器件级异常不会阻止后续器件，保存失败作为独立结果行返回。
 */
export async function executeWrites(host: OperationHost, scope: Scope, plan: WritePlan, reportIssues: (issues: WritePlan['issues']) => Promise<void>, progress: (done: number, total: number) => void): Promise<OperationRow[]> {
	const results: OperationRow[] = [];
	if (plan.issues.length)
		await reportIssues(plan.issues);
	if (!plan.items.length)
		return results;
	/**
	 * 覆盖器件数按至少一个原值可见的写入项计算，覆盖字段数直接使用计划计数。
	 * 这两种数量分别呈现在一次确认中，用户放弃后返回一条整批取消记录。
	 */
	const overwriteComponents = plan.items.filter(item => item.changes.some(change => hasVisible(change.before))).length;
	if (plan.overwriteCount && !await host.confirm(notices.confirmWrite(overwriteComponents, plan.overwriteCount), messages.writeConfirmTitle, 'write')) {
		return [
			{
				位号: '',
				文档: scope.name,
				字段: '',
				结果: '已取消',
				说明: messages.writeCancelled,
			},
		];
	}
	await host.assertProject(scope);
	for (const [index, item] of plan.items.entries()) {
		const base = { 位号: item.component.designator, 文档: item.component.documentName };
		try {
			/**
			 * 执行前读取实际图元，校对位号和唯一标识，避免把旧计划应用到身份已变化的对象。
			 * 字段校对基于此次实际快照，未列入计划的属性由宿主适配层继续保留。
			 */
			const actual = await host.readOne(scope, item.component);
			if (actual.designator !== item.component.designator || actual.uniqueId !== item.component.uniqueId)
				throw new Error(messages.identityChanged);
			/**
			 * 每个字段的实际原值必须仍等于计划前值，否则该字段记录为跳过。
			 * 比较使用统一文本表示，与计划生成时的值比较保持一致。
			 */
			const valid = item.changes.filter((change) => {
				if (scalarText(fieldValue(actual, change.field)) === scalarText(change.before))
					return true;
				results.push({
					...base,
					字段: change.field.label,
					结果: '跳过',
					说明: messages.valueChanged,
				});
				return false;
			});
			if (valid.length) {
				/**
				 * 仅提交通过前值校验的字段，随后用宿主回读快照核对每个目标值。
				 * 日志保存合并来源、有效分隔符、修改前值和目标值，使成功与回读不符都可追查。
				 */
				const after = await host.write(scope, actual, valid);
				for (const change of valid) {
					const success = scalarText(fieldValue(after, change.field)) === scalarText(change.after);
					results.push({
						...base,
						字段: change.field.label,
						结果: success ? '成功' : '失败',
						说明: success ? messages.writeVerified : messages.writeMismatch,
						原值: scalarText(change.before),
						目标值: scalarText(change.after),
						合并来源: scalarText(change.sources ?? []),
						合并分隔: change.separator ?? '',
					});
				}
			}
		}
		catch (error) {
			results.push({
				...base,
				字段: item.changes.map(change => change.field.label).join('、'),
				结果: '失败',
				说明: messages.failed,
				详情: errorText(error),
			});
		}
		progress(index + 1, plan.items.length);
		if (index % YIELD_INTERVAL === 0)
			await yieldUi();
	}
	try {
		await host.save(scope);
	}
	catch (error) {
		results.push({
			位号: '',
			文档: scope.name,
			字段: '',
			结果: '保存失败',
			说明: messages.saveFailed,
			详情: errorText(error),
		});
	}
	return results;
}

/**
 * 从完整工程独有集合选取位号分组明确的器件，不读取表格筛选结果。
 * 清单无记录、没有可删除对象或清单存在解析问题时，在请求用户确认及调用删除接口前拒绝执行。
 * 确认后按文档和固定批大小读取实际身份，再优先使用数组删除并核对返回结果。
 * 已确认删除的对象不重复提交，仍存在的对象逐个处理，核验异常的批次不盲目重试。
 */
export async function executeDelete(host: OperationHost, scope: Scope, result: Comparison, progress: (done: number, total: number) => void): Promise<OperationRow[]> {
	const candidates = result.projectOnly.filter(component => isUnambiguousGroup(result.groups.get(referenceKey(component.designator, result.bom.ignoreCase)) ?? []));
	if (!result.bom.records.length || !candidates.length)
		throw new Error(messages.noDelete);
	if (result.bom.issues.some(issue => issue.stage === '解析'))
		throw new Error(messages.unsafeDelete);
	if (!await host.confirm(notices.confirmDelete(scope.kind === 'pcb'
		? 'PCB'
		: '原理图', scope.documents.length, candidates.length), messages.deleteConfirmTitle, 'delete')) {
		return [
			{
				位号: '',
				文档: scope.name,
				字段: '',
				结果: '已取消',
				说明: messages.deleteCancelled,
			},
		];
	}
	const rows: OperationRow[] = [];
	/**
	 * 以统一字段记录每个器件的删除结果，保留文档、位号和失败详情。
	 * 进度按已经产生的器件结果行计算，保存结果在批量处理结束后单独添加。
	 */
	const record = (component: ComponentSnapshot, success: boolean, message = ''): void => {
		rows.push({
			位号: component.designator,
			文档: component.documentName,
			字段: '',
			结果: success ? '删除成功' : '删除失败',
			说明: success ? messages.deleteVerified : messages.deleteRemains,
			详情: message,
		});
	};
	/**
	 * 按范围声明的文档顺序处理，每个数组删除批次只包含同一文档的图元。
	 * 每批先重新读取身份，读取失败的对象立即记录失败，不进入实际删除列表。
	 */
	for (const document of scope.documents) {
		const current = candidates.filter(component => component.documentId === document.id);
		for (let offset = 0; offset < current.length; offset += DELETE_BATCH_SIZE) {
			const valid: ComponentSnapshot[] = [];
			for (const component of current.slice(offset, offset + DELETE_BATCH_SIZE)) {
				try {
					const actual = await host.readOne(scope, component);
					if (actual.designator !== component.designator || actual.uniqueId !== component.uniqueId)
						throw new Error(messages.identityChanged);
					valid.push(actual);
				}
				catch (error) {
					record(component, false, errorText(error));
				}
			}
			/**
			 * 数组删除返回已确认不存在的图元标识集合。
			 * 数组接口抛出异常时记录整批失败并进入下一批，避免重复删除状态尚未核实的对象。
			 */
			let removed = new Set<string>();
			if (host.removeMany && valid.length) {
				try {
					removed = new Set((await host.removeMany(scope, valid)).removed);
				}
				catch (error) {
					// 核验无法完成时不再次删除，避免对已经生效的操作盲目重试。
					valid.forEach(component => record(component, false, errorText(error)));
					progress(rows.length, candidates.length);
					continue;
				}
			}
			for (const component of valid) {
				if (removed.has(component.id)) {
					record(component, true);
					continue;
				}
				try {
					// 批量删除后仍存在的器件独立处理，局部失败不会阻断同批其他器件。
					await host.remove(scope, component);
					record(component, true);
				}
				catch (error) {
					record(component, false, errorText(error));
				}
			}
			progress(rows.length, candidates.length);
			await yieldUi();
		}
	}
	try {
		await host.save(scope);
	}
	catch (error) {
		rows.push({
			位号: '',
			文档: scope.name,
			字段: '',
			结果: '保存失败',
			说明: messages.saveFailed,
			详情: errorText(error),
		});
	}
	return rows;
}
