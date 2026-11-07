/**
 * 封装嘉立创EDA公开接口，将宿主图元转换为可跨步骤使用的普通数据快照。
 * 读取、修改、删除和保存均先定位指定文档，业务层不保存宿主图元实例。
 * 快照不具备自动恢复能力，持久化原值记录用于后续查看和导出。
 */
import type { ComponentSnapshot, FieldChange, Scalar, Scope, Values } from './model';
import commands from '../ui/commands.json';
import { messages, notices } from './messages';
import { DOCUMENT_TIMEOUT_MS, errorText, scalarText, yieldUi } from './rules';

/** 宿主适配只使用官方eda对象，业务层不会持有随文档切换而失效的图元对象。 */
export class EdaHost {
	/**
	 * 注入实际 eda 对象，测试也可提供符合公开接口的受控运行对象。
	 */
	constructor(private readonly runtime: EDA) {}

	/**
	 * 直接读取当前编辑器报告的版本文本，不从路径、清单或客户端文件名推断。
	 */
	version(): string {
		return this.runtime.sys_Environment.getEditorCurrentVersion();
	}

	/**
	 * 读取当前工程的板子、独立 PCB 和原理图，按文档 UUID 去重。
	 * PCB 范围包含一个文档，原理图范围保留全部图页的标识和名称。
	 * 公开工程就绪接口存在时先等待加载，最后返回当前活动文档供界面选择默认范围。
	 */
	async scopes(): Promise<{ scopes: Scope[]; activeDocument?: string }> {
		const project = await this.runtime.dmt_Project.getCurrentProjectInfo();
		if (!project)
			throw new Error(messages.projectClosed);
		if (typeof this.runtime.dmt_Project.waitForReady === 'function' && !await this.runtime.dmt_Project.waitForReady(project.uuid, DOCUMENT_TIMEOUT_MS))
			throw new Error(messages.projectLoading);
		const scopes: Scope[] = [];
		/**
		 * 将可处理节点转换为统一范围结构，并保留所属工程身份。
		 * 相同 UUID 的节点只加入一次，其他节点类型不生成处理范围。
		 */
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
		/**
		 * 板子节点分别提取其 PCB 和原理图，独立 PCB 与原理图直接交给同一转换入口。
		 * 范围名称用于显示，实际访问只依赖 UUID 和范围类型。
		 */
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

	/**
	 * 检查当前工程 UUID 是否仍等于范围创建时的工程 UUID。
	 * 工程已关闭或切换均抛出身份错误，调用方不能继续使用该范围访问其他工程。
	 */
	async assertProject(scope: Scope): Promise<void> {
		const project = await this.runtime.dmt_Project.getCurrentProjectInfo();
		if (project?.uuid !== scope.projectId)
			throw new Error(messages.projectChanged);
	}

	/**
	 * 检查工程身份，必要时打开目标文档，并确认当前文档 UUID 与目标一致。
	 * 宿主提供文档就绪接口时，在强制等待或实际切换文档后调用该接口。
	 * 没有公开就绪接口时，此方法只核对文档身份，稳定读取由 readScope 负责。
	 */
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

	/**
	 * 根据范围类型选择 PCB 或原理图器件接口，所有修改和单对象读取共用此入口。
	 */
	private api(scope: Scope): SCH_PrimitiveComponent | PCB_PrimitiveComponent {
		return scope.kind === 'pcb'
			? this.runtime.pcb_PrimitiveComponent
			: this.runtime.sch_PrimitiveComponent;
	}

	/**
	 * PCB 读取当前板内器件；原理图限定普通器件类型且不跨其他图页。
	 * 全部原理图图页的遍历顺序由 readScope 控制，避免一次接口调用造成重复采集。
	 */
	private async all(scope: Scope): Promise<(ISCH_PrimitiveComponent | IPCB_PrimitiveComponent)[]> {
		return scope.kind === 'pcb'
			? this.runtime.pcb_PrimitiveComponent.getAll()
			: this.runtime.sch_PrimitiveComponent.getAll(ESCH_PrimitiveComponentType.COMPONENT, false);
	}

	/**
	 * 读取公开属性构造普通数据，保留工程、文档、图元、位号和多单元身份。
	 * 标准属性与其他属性分别保存，宿主返回的对象型其他属性转为 JSON 文本。
	 * 坐标、封装及网络等元信息只供展示和导出，不在普通属性映射中自动写入。
	 */
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
		/**
		 * 根据文档类型提取对应公开元信息。PCB 保留焊盘、层及模型，原理图保留符号、网络及器件类型。
		 * 原理图另提供转到 PCB 的布尔标准字段，PCB 快照不提供该字段。
		 */
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

	/**
	 * 按范围顺序逐文档打开并等待读取，任一文档失败即拒绝返回完整结果。
	 * 没有公开就绪接口时，每隔 250 毫秒读取图元标识，要求连续三次标识集合保持一致。
	 * 稳定检查只比较标识集合，不代表其他属性完全静止；超时抛出文档不稳定错误。
	 * 每页转为快照后归还一次事件循环，进度回调报告已开始读取的文档序号。
	 */
	async readScope(scope: Scope, progress: (text: string) => void = () => {}): Promise<ComponentSnapshot[]> {
		const result: ComponentSnapshot[] = [];
		for (const document of scope.documents) {
			progress(notices.read(scope.documents.indexOf(document) + 1, scope.documents.length));
			await this.activate(scope, document.id, true);
			let components = await this.all(scope);
			/**
			 * 旧宿主通过重复读取身份集合确认采集时机。空集合也参与稳定计数。
			 * 计时在该文档开始稳定检查时建立，不会因某次集合变化而延长截止时间。
			 */
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

	/**
	 * 先激活原文档，再按图元标识查询当前对象并重新生成快照。
	 * 不存在的对象明确报错；此方法本身不比较位号和唯一标识，业务操作层负责对应校验。
	 */
	async readOne(scope: Scope, component: ComponentSnapshot): Promise<ComponentSnapshot> {
		await this.activate(scope, component.documentId);
		const actual = await this.api(scope).get(component.id);
		if (!actual)
			throw new Error(messages.componentMissing);
		return this.snapshot(actual, scope, component.documentId, component.documentName);
	}

	/**
	 * 同一器件的标准字段汇总为一个补丁，其他字段基于传入快照的整个其他属性字典合并。
	 * 提交前激活原文档，modify 没有返回对象时报告失败，成功返回后仍重新读取实际图元。
	 * 传入快照应由操作层刚刚读取，回读核对目标值也由操作层逐字段完成。
	 */
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

	/**
	 * 将单器件删除复用为单元素数组删除，只有回读确认其标识不存在才视为成功。
	 * 宿主返回失败但对象实际已消失时仍按真实核验结果完成。
	 */
	async remove(scope: Scope, component: ComponentSnapshot): Promise<void> {
		const result = await this.removeMany(scope, [component]);
		if (!result.removed.includes(component.id))
			throw new Error(result.error || messages.deleteRemains);
	}

	/**
	 * 只接受同一文档的目标，空数组直接返回，不调用宿主删除接口。
	 * 记录宿主删除异常或失败返回，再读取当前文档的图元标识集合确认实际删除对象。
	 * 标识读取失败会直接抛出，调用方据此避免对结果未核实的批次再次删除。
	 */
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
		/**
		 * 按文档类型获取当前完整身份集合，原理图明确限定当前图页的普通器件。
		 * 只有已提交目标中不在该集合的标识进入 removed，不依赖宿主删除返回值推定成功。
		 */
		const ids = new Set(scope.kind === 'pcb'
			? await this.runtime.pcb_PrimitiveComponent.getAllPrimitiveId()
			: await this.runtime.sch_PrimitiveComponent.getAllPrimitiveId(ESCH_PrimitiveComponentType.COMPONENT, false));
		return {
			removed: components.filter(component => !ids.has(component.id)).map(component => component.id),
			error,
		};
	}

	/**
	 * 逐个激活范围文档并调用对应保存接口。
	 * 只有明确的 false 返回值判为保存失败，异常同样向业务层传播，不伪造保存成功结果。
	 */
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

	/**
	 * 将宿主带回调的确认框转换为 Promise，并根据写入或删除选择对应按钮文字。
	 * 返回用户选择的布尔结果，整批确认的调用次数由操作服务控制。
	 */
	confirm(content: string, title: string, kind: 'write' | 'delete' = 'write'): Promise<boolean> {
		return new Promise(resolve => this.runtime.sys_Dialog.showConfirmationMessage(content, title, kind === 'delete'
			? commands.confirmDelete
			: commands.confirmWrite, kind === 'delete'
			? commands.cancelDelete
			: commands.cancelWrite, resolve));
	}

	/**
	 * 将文件内容和建议名称交给宿主保存接口，文件位置由宿主与用户选择。
	 * 接口完成表示宿主保存流程已返回，不在扩展中推断用户磁盘目录。
	 */
	async saveFile(data: Blob, filename: string): Promise<void> {
		await this.runtime.sys_FileSystem.saveFile(data, filename);
	}

	/**
	 * 把修改前计划或删除候选序列化后写入当前扩展的用户配置 recovery 键。
	 * 宿主未确认存储成功时抛错，界面在此之后才调用工程修改服务。
	 */
	async storeRecovery(data: unknown): Promise<void> {
		if (!await this.runtime.sys_Storage.setExtensionUserConfig('recovery', JSON.stringify(data)))
			throw new Error(messages.recoveryFailed);
	}

	/**
	 * 读取宿主中 recovery 键的原始返回值。该值按存储方式为 JSON 文本，不在此处解析或执行恢复。
	 */
	recovery(): unknown {
		return this.runtime.sys_Storage.getExtensionUserConfig('recovery');
	}
}
