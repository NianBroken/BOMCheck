import type { ComponentSnapshot, FieldChange, Scalar, Scope, Values } from './model';
import commands from '../ui/commands.json';
import { messages, notices } from './messages';
import { DOCUMENT_TIMEOUT_MS, errorText, scalarText, yieldUi } from './rules';

/** 宿主适配只使用官方eda对象，业务层不会持有随文档切换而失效的图元对象。 */
export class EdaHost {
	constructor(private readonly runtime: EDA) {}

	/** 版本信息直接取自当前编辑器，不用客户端安装目录推断宿主版本。 */
	version(): string {
		return this.runtime.sys_Environment.getEditorCurrentVersion();
	}

	/** 板子归属文档与独立文档统一转换为范围，原理图保留全部图页身份。 */
	async scopes(): Promise<{ scopes: Scope[]; activeDocument?: string }> {
		const project = await this.runtime.dmt_Project.getCurrentProjectInfo();
		if (!project)
			throw new Error(messages.projectClosed);
		if (typeof this.runtime.dmt_Project.waitForReady === 'function' && !await this.runtime.dmt_Project.waitForReady(project.uuid, DOCUMENT_TIMEOUT_MS))
			throw new Error(messages.projectLoading);
		const scopes: Scope[] = [];
		const append = (node: IDMT_PcbItem | IDMT_SchematicItem): void => {
			if (scopes.some(scope => scope.id === node.uuid))
				return;
			if (node.itemType === EDMT_ItemType.PCB) {
				scopes.push({
					id: node.uuid,
					name: `PCB / ${node.name}`,
					kind: 'pcb',
					projectId: project.uuid,
					projectName: project.friendlyName,
					documents: [
						{ id: node.uuid, name: node.name },
					],
				});
			}
			else if (node.itemType === EDMT_ItemType.SCHEMATIC) {
				const schematic = node as IDMT_SchematicItem;
				scopes.push({
					id: node.uuid,
					name: `原理图全部图页 / ${node.name}`,
					kind: 'sch',
					projectId: project.uuid,
					projectName: project.friendlyName,
					documents: schematic.page.map(page => ({ id: page.uuid, name: page.name })),
				});
			}
		};
		for (const node of project.data) {
			if (node.itemType === EDMT_ItemType.BOARD) {
				if (node.pcb)
					append(node.pcb);
				if (node.schematic)
					append(node.schematic);
			}
			else if (node.itemType === EDMT_ItemType.PCB || node.itemType === EDMT_ItemType.SCHEMATIC) {
				append(node);
			}
		}
		const active = await this.runtime.dmt_SelectControl.getCurrentDocumentInfo();
		return { scopes, activeDocument: active?.uuid };
	}

	/** 工程身份校验贯穿读取和写入，窗口切换不能将操作带入另一个工程。 */
	async assertProject(scope: Scope): Promise<void> {
		const project = await this.runtime.dmt_Project.getCurrentProjectInfo();
		if (project?.uuid !== scope.projectId)
			throw new Error(messages.projectChanged);
	}

	/** 4.1使用就绪接口，3.2通过实际文档身份和连续稳定读取确认完成加载。 */
	async activate(scope: Scope, documentId: string, waitForReady = false): Promise<void> {
		await this.assertProject(scope);
		const active = await this.runtime.dmt_SelectControl.getCurrentDocumentInfo();
		if (active?.uuid !== documentId) {
			const tab = await this.runtime.dmt_EditorControl.openDocument(documentId);
			if (!tab)
				throw new Error(messages.documentFailed);
		}
		if ((waitForReady || active?.uuid !== documentId) && typeof this.runtime.dmt_EditorControl.waitForDocumentReady === 'function') {
			if (!await this.runtime.dmt_EditorControl.waitForDocumentReady(documentId, DOCUMENT_TIMEOUT_MS))
				throw new Error(messages.documentTimeout);
		}
		const current = await this.runtime.dmt_SelectControl.getCurrentDocumentInfo();
		if (current?.uuid !== documentId)
			throw new Error(messages.documentChanged);
	}

	private api(scope: Scope): SCH_PrimitiveComponent | PCB_PrimitiveComponent {
		return scope.kind === 'pcb'
			? this.runtime.pcb_PrimitiveComponent
			: this.runtime.sch_PrimitiveComponent;
	}

	/** 原理图明确只读取当前页，图页遍历由readScope统一管理。 */
	private async all(scope: Scope): Promise<(ISCH_PrimitiveComponent | IPCB_PrimitiveComponent)[]> {
		return scope.kind === 'pcb'
			? this.runtime.pcb_PrimitiveComponent.getAll()
			: this.runtime.sch_PrimitiveComponent.getAll(ESCH_PrimitiveComponentType.COMPONENT, false);
	}

	/** 只转换API公开的属性，复杂值保留为JSON用于详情和导出。 */
	private snapshot(component: ISCH_PrimitiveComponent | IPCB_PrimitiveComponent, scope: Scope, documentId: string, documentName: string): ComponentSnapshot {
		const standard: Values = {
			name: component.getState_Name(),
			manufacturer: component.getState_Manufacturer(),
			manufacturerId: component.getState_ManufacturerId(),
			supplier: component.getState_Supplier(),
			supplierId: component.getState_SupplierId(),
			addIntoBom: component.getState_AddIntoBom(),
		};
		const other = Object.fromEntries(Object.entries(component.getState_OtherProperty() ?? {}).map(([key, value]) => [
			key,
			typeof value === 'object'
				? scalarText(value)
				: value,
		])) as Values;
		const metadata: Record<string, unknown> = {
			器件库关联: component.getState_Component(),
			坐标X: component.getState_X(),
			坐标Y: component.getState_Y(),
			旋转: component.getState_Rotation(),
		};
		if (scope.kind === 'pcb') {
			const pcb = component as IPCB_PrimitiveComponent;
			metadata.封装 = pcb.getState_Footprint();
			metadata.层 = pcb.getState_Layer();
			metadata.锁定 = pcb.getState_PrimitiveLock();
			metadata.模型 = pcb.getState_Model3D();
			metadata.焊盘与网络 = pcb.getState_Pads();
		}
		else {
			const schematic = component as ISCH_PrimitiveComponent;
			standard.addIntoPcb = schematic.getState_AddIntoPcb();
			metadata.符号 = schematic.getState_Symbol();
			metadata.封装 = schematic.getState_Footprint();
			metadata.镜像 = schematic.getState_Mirror();
			metadata.网络 = schematic.getState_Net();
			metadata.器件类型 = schematic.getState_ComponentType();
		}
		return {
			id: component.getState_PrimitiveId(),
			documentId,
			documentName,
			projectId: scope.projectId,
			designator: component.getState_Designator() ?? '',
			uniqueId: component.getState_UniqueId() ?? '',
			subPart: scope.kind === 'sch'
				? (component as ISCH_PrimitiveComponent).getState_SubPartName() ?? ''
				: '',
			standard,
			other,
			metadata,
		};
	}

	/** 每个图页完成打开与加载核对后读取，任一图页失败则不返回不完整的工程集合。 */
	async readScope(scope: Scope, progress: (text: string) => void = () => {}): Promise<ComponentSnapshot[]> {
		const result: ComponentSnapshot[] = [];
		for (const document of scope.documents) {
			progress(notices.read(scope.documents.indexOf(document) + 1, scope.documents.length));
			await this.activate(scope, document.id, true);
			let components = await this.all(scope);
			if (typeof this.runtime.dmt_EditorControl.waitForDocumentReady !== 'function') {
				// 旧版没有公开就绪接口，连续读取相同身份集合后才使用结果。
				let previous = '';
				let stable = 0;
				const deadline = Date.now() + DOCUMENT_TIMEOUT_MS;
				while (stable < 3 && Date.now() < deadline) {
					await new Promise<void>(resolve => setTimeout(resolve, 250));
					components = await this.all(scope);
					const signature = components.map(component => component.getState_PrimitiveId()).sort().join('|');
					stable = signature === previous
						? stable + 1
						: 0;
					previous = signature;
				}
				if (stable < 3)
					throw new Error(messages.documentUnstable);
			}
			result.push(...components.map(component => this.snapshot(component, scope, document.id, document.name)));
			await yieldUi();
		}
		return result;
	}

	/** 操作前按原文档和图元标识重新取值，快照本身不具有修改工程的能力。 */
	async readOne(scope: Scope, component: ComponentSnapshot): Promise<ComponentSnapshot> {
		await this.activate(scope, component.documentId);
		const actual = await this.api(scope).get(component.id);
		if (!actual)
			throw new Error(messages.componentMissing);
		return this.snapshot(actual, scope, component.documentId, component.documentName);
	}

	/** 同器件字段合并为一次修改，其他属性沿用原字典，并重新读取宿主实际值。 */
	async write(scope: Scope, component: ComponentSnapshot, changes: FieldChange[]): Promise<ComponentSnapshot> {
		const patch: Record<string, Scalar | Values> = {};
		const other = { ...component.other };
		for (const change of changes) {
			if (change.field.kind === 'other')
				other[change.field.key] = change.after;
			else patch[change.field.key] = change.after;
		}
		if (changes.some(change => change.field.kind === 'other'))
			patch.otherProperty = other;
		await this.activate(scope, component.documentId);
		const updated = await this.api(scope).modify(component.id, patch);
		if (!updated)
			throw new Error(messages.writeNoResponse);
		return this.readOne(scope, component);
	}

	async remove(scope: Scope, component: ComponentSnapshot): Promise<void> {
		const result = await this.removeMany(scope, [component]);
		if (!result.removed.includes(component.id))
			throw new Error(result.error || messages.deleteRemains);
	}

	/** 同文档使用公开数组删除接口，核验只读取身份列表，避免反复构造整页器件和撤销快照。 */
	async removeMany(scope: Scope, components: ComponentSnapshot[]): Promise<{ removed: string[]; error: string }> {
		if (!components.length)
			return { removed: [], error: '' };
		if (components.some(component => component.documentId !== components[0].documentId))
			throw new Error(messages.crossDocument);
		await this.activate(scope, components[0].documentId);
		let error = '';
		try {
			if (!await this.api(scope).delete(components.map(component => component.id)))
				error = '宿主返回删除失败';
		}
		catch (failure) {
			error = errorText(failure);
		}
		const ids = new Set(scope.kind === 'pcb'
			? await this.runtime.pcb_PrimitiveComponent.getAllPrimitiveId()
			: await this.runtime.sch_PrimitiveComponent.getAllPrimitiveId(ESCH_PrimitiveComponentType.COMPONENT, false));
		return {
			removed: components.filter(component => !ids.has(component.id)).map(component => component.id),
			error,
		};
	}

	/** 保存处理范围内的每个文档，false返回值明确作为保存失败向业务层报告。 */
	async save(scope: Scope): Promise<void> {
		for (const document of scope.documents) {
			await this.activate(scope, document.id);
			const result = scope.kind === 'pcb'
				? await this.runtime.pcb_Document.save()
				: await this.runtime.sch_Document.save();
			if (result === false)
				throw new Error(messages.saveFailed);
		}
	}

	/** 宿主确认回调转换为Promise，由批量服务决定整批确认次数。 */
	confirm(content: string, title: string, kind: 'write' | 'delete' = 'write'): Promise<boolean> {
		return new Promise(resolve => this.runtime.sys_Dialog.showConfirmationMessage(content, title, kind === 'delete'
			? commands.confirmDelete
			: commands.confirmWrite, kind === 'delete'
			? commands.cancelDelete
			: commands.cancelWrite, resolve));
	}

	/** 文件保存交给宿主，扩展不预设用户目录或操作系统路径。 */
	async saveFile(data: Blob, filename: string): Promise<void> {
		await this.runtime.sys_FileSystem.saveFile(data, filename);
	}

	/** 恢复数据在修改前持久保存，关闭窗口后仍可从操作记录入口导出。 */
	async storeRecovery(data: unknown): Promise<void> {
		if (!await this.runtime.sys_Storage.setExtensionUserConfig('recovery', JSON.stringify(data)))
			throw new Error(messages.recoveryFailed);
	}

	recovery(): unknown {
		return this.runtime.sys_Storage.getExtensionUserConfig('recovery');
	}
}
