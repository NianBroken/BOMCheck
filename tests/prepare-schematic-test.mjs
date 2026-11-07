/** 生成调用公开宿主接口的真实多图页测试，3.2与4.1使用同一业务模块。 */
import fs from 'node:fs/promises';
import * as esbuild from 'esbuild';

async function main() {
	const bundle = await esbuild.build({
		entryPoints: ['tests/live-host-entry.ts'],
		bundle: true,
		format: 'iife',
		globalName: 'BOMCheckLive',
		write: false,
	});
	await fs.writeFile('tests/output/live-host-current.js', bundle.outputFiles[0].text, 'utf8');
	const body = `
const host = new BOMCheckLive.EdaHost(eda);
const before = await eda.dmt_Project.getCurrentProjectInfo();
if (!before.friendlyName.includes('BOMCheck')) throw new Error('只允许独立验收工程');
const systemLibrary = await eda.lib_LibrariesList.getSystemLibraryUuid();
const candidates = await eda.lib_Symbol.search('LM358',systemLibrary,undefined,undefined,20,1);
let candidate;
for (const item of candidates) {
  const symbol = await eda.lib_Symbol.get(item.uuid,item.libraryUuid);
  if (symbol?.subPartNames?.length>=2) { candidate=symbol; break; }
}
if (!candidate) throw new Error('系统库未找到LM358多单元符号');
const library = {...candidate,libraryType:ELIB_LibraryType.SYMBOL};
const schematic = await eda.dmt_Schematic.createSchematic();
if (!schematic) throw new Error('原理图创建失败');
const pages = [];
for (let i=0;i<3;i++) pages.push(await eda.dmt_Schematic.createSchematicPage(schematic));
const created=[];
for(let i=0;i<2;i++){
  await eda.dmt_EditorControl.openDocument(pages[i]);
  await new Promise(r=>setTimeout(r,1200));
  const part=await eda.sch_PrimitiveComponent.create(library,100+i*100,100,candidate.subPartNames[i]);
  if(!part) throw new Error('多单元器件创建失败');
  const other={...part.getState_OtherProperty(),Description:' ',KeepOriginal:'原理图保留属性'};
  await eda.sch_PrimitiveComponent.modify(part.getState_PrimitiveId(),{designator:'TEST_U1',uniqueId:'BOMCHECK_SHARED_UNIT',otherProperty:other});
  await eda.sch_Document.save();
  created.push({page:pages[i],id:part.getState_PrimitiveId()});
}
await eda.dmt_Pcb.createPcb();
const range=await host.scopes();
const scope=range.scopes.find(s=>s.id===schematic);
const components=await host.readScope(scope);
const bom={file:'真实多页验收.csv',sheet:'Sheet1',columns:[{id:'col:0',index:0,header:'位号',label:'A · 位号'},{id:'col:1',index:1,header:'描述',label:'B · 描述'}],records:[{designator:'TEST_U1',key:'TEST_U1',row:2,values:{'col:0':'TEST_U1','col:1':'多页多单元实际写入'},valid:true}],issues:[],ignoreCase:false};
const result=BOMCheckLive.compare(bom,components);
const plan=BOMCheckLive.planWrites(result,[{columnId:'col:1',fieldId:'other:Description'}],BOMCheckLive.targetFields(components),false);
const operations=await BOMCheckLive.executeWrites(host,scope,plan,async()=>{},()=>{});
const after=await host.readScope(scope);
return {version:host.version(),project:before.uuid,schematic,pages,created,scope,scopes:range.scopes,logicalMatched:result.matchedCount,issues:plan.issues,operations,after};
`;
	const script = `${bundle.outputFiles[0].text}\n(async()=>{${body}})()`;
	const expression = `(()=>{const frame=[...document.querySelectorAll("iframe")].find(f=>f.src.startsWith("blob:")); return frame.contentWindow.eval(${JSON.stringify(script)});})()`;
	await fs.writeFile('tests/output/cdp32-schematic.js', expression, 'utf8');
	await fs.writeFile('tests/output/ui41-schematic.js', `${bundle.outputFiles[0].text}\n${body}`, 'utf8');
}

void main();
