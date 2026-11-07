/** 通过公开接口读取测试工程的器件字段快照。 */
(async () => ({
	project: (await globalThis.eda.dmt_Project.getCurrentProjectInfo()).friendlyName,
	components: (await globalThis.eda.pcb_PrimitiveComponent.getAll()).map(c => ({
		id: c.getState_PrimitiveId(),
		ref: c.getState_Designator(),
		supplier: c.getState_SupplierId(),
		other: c.getState_OtherProperty(),
	})),
}))();
