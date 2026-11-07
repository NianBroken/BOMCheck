import type { EdaHost } from './host';
import type { Comparison, ComponentSnapshot, OperationRow, Scope, WritePlan } from './model';
import { isUnambiguousGroup } from './compare';
import { messages, notices } from './messages';
import { DELETE_BATCH_SIZE, errorText, fieldValue, hasVisible, referenceKey, scalarText, YIELD_INTERVAL, yieldUi } from './rules';

/** 操作服务依赖宿主端口，真实客户端和隔离测试执行同一套业务流程。 */
export type OperationHost = Pick<EdaHost, 'confirm' | 'readOne' | 'write' | 'remove' | 'assertProject' | 'save'> & Partial<Pick<EdaHost, 'removeMany'>>;

export async function executeWrites(host: OperationHost, scope: Scope, plan: WritePlan, reportIssues: (issues: WritePlan['issues']) => Promise<void>, progress: (done: number, total: number) => void): Promise<OperationRow[]> {
	const results: OperationRow[] = [];
	if (plan.issues.length)
		await reportIssues(plan.issues);
	if (!plan.items.length)
		return results;
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
			const actual = await host.readOne(scope, item.component);
			if (actual.designator !== item.component.designator || actual.uniqueId !== item.component.uniqueId)
				throw new Error(messages.identityChanged);
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

/** 删除使用完整差异集合，界面搜索与排序不参与目标确定。 */
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
