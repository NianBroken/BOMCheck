"""在独立 Excel 进程中只读打开导出样例，核对标准与自定义文档属性。
另开线程观察真实属性对话框并截图，主线程维持 Excel 模态对话框调用。
最终关闭只读工作簿、退出独立进程并清理临时目录。
文件路径和报告目录由参数提供，脚本不连接用户已有 Excel 进程，也不写回样例工作簿。"""
import argparse
import json
import sys
import threading
import time
import tempfile
from pathlib import Path
import win32com.client
import win32gui
from pywinauto import Desktop

sys.stdout.reconfigure(encoding='utf-8')
parser=argparse.ArgumentParser()
parser.add_argument('--file',required=True)
parser.add_argument('--output')
args=parser.parse_args()
# 没有指定输出目录时使用当前运行独立临时目录，避免截图混入项目源文件。
temporary=tempfile.TemporaryDirectory(prefix='bomcheck-excel-')
output=Path(args.output) if args.output else Path(temporary.name)
output.mkdir(parents=True,exist_ok=True)
# 建立独立 Excel 应用，不连接用户原有工作簿进程，样例以 ReadOnly 打开。
app=win32com.client.DispatchEx('Excel.Application')
app.Visible=True
book=app.Workbooks.Open(str(Path(args.file).resolve()),ReadOnly=True)
report={'standard':{},'custom':{},'tabs':[]}
# 从 Excel 实际文档属性接口取值，不用工作簿文件名或自建对象替代验证；标准属性和自定义属性分别保存在报告的两个字典中。
for key in ['Author','Last Author','Company','Keywords','Comments']:
 report['standard'][key]=book.BuiltinDocumentProperties(key).Value
for p in book.CustomDocumentProperties:
 report['custom'][p.Name]=p.Value
for key in ['Author','Last Author','Company','Keywords']:
 assert report['standard'][key]=='NianBroken',key
assert report['standard']['Comments']=='https://www.klaio.top/'
assert report['custom']['Copyright']=='NianBroken'
assert report['custom']['Website']==report['custom']['Link']=='https://www.klaio.top/'
main_handle=app.Hwnd
failures=[]
# 等待属于当前 Excel 主窗口的可见原生属性对话框，遍历摘要与自定义页并保存截图。
# 线程异常保留在 failures，主线程结束模态调用后统一报告。
def inspect_dialog():
 try:
  deadline=time.monotonic()+15
  handles=[]
  while not handles and time.monotonic()<deadline:
   win32gui.EnumWindows(lambda h,_: handles.append(h) if win32gui.IsWindowVisible(h) and win32gui.GetClassName(h)=='#32770' and win32gui.GetWindow(h,4)==main_handle else None,None)
   time.sleep(.1)
  if not handles: raise RuntimeError('Excel属性窗口没有显示')
  dialog=Desktop(backend='uia').window(handle=handles[0])
  for tab in dialog.descendants(control_type='TabItem'):
   name=tab.window_text();report['tabs'].append(name)
   if name in ['摘要','自定义','Summary','Custom']:
    tab.select();time.sleep(.15);dialog.set_focus()
    kind='summary' if name in ['摘要','Summary'] else 'custom'
    dialog.capture_as_image().save(output / f'excel-{kind}.png')
  dialog.child_window(title='取消',control_type='Button').click()
 except BaseException as error:
  failures.append(str(error))
  win32gui.PostMessage(main_handle,0x0010,0,0)
# 观察线程使用 daemon，主线程开启属性对话框后等待其完成，再验证报告没有线程失败。
thread=threading.Thread(target=inspect_dialog,daemon=True)
try:
 thread.start();app.Dialogs(474).Show();thread.join(20)
 if failures: raise RuntimeError('; '.join(failures))
 (output/'excel-properties.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print('Excel标准属性、自定义属性与实际属性窗口核验通过')
# 不保存关闭工作簿并退出当前独立 Excel，临时目录始终释放。
finally:
 book.Close(SaveChanges=False);app.Quit();temporary.cleanup()
