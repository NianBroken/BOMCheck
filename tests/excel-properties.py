"""在独立Excel进程中核实文档属性并截取真实属性窗口，不改写导出样例。"""
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
temporary=tempfile.TemporaryDirectory(prefix='bomcheck-excel-')
output=Path(args.output) if args.output else Path(temporary.name)
output.mkdir(parents=True,exist_ok=True)
app=win32com.client.DispatchEx('Excel.Application')
app.Visible=True
book=app.Workbooks.Open(str(Path(args.file).resolve()),ReadOnly=True)
report={'standard':{},'custom':{},'tabs':[]}
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
thread=threading.Thread(target=inspect_dialog,daemon=True)
try:
 thread.start();app.Dialogs(474).Show();thread.join(20)
 if failures: raise RuntimeError('; '.join(failures))
 (output/'excel-properties.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
 print('Excel标准属性、自定义属性与实际属性窗口核验通过')
finally:
 book.Close(SaveChanges=False);app.Quit();temporary.cleanup()
