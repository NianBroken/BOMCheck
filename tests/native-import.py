"""在同一个原生文件选择流程中输入路径，避免切换主窗口焦点触发取消。"""
import argparse
import sys
import time
from pathlib import Path
import win32con
import win32gui
from pywinauto import Desktop

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
parser = argparse.ArgumentParser()
parser.add_argument("--handle", type=int, required=True)
parser.add_argument("--file", required=True)
parser.add_argument("--dialog-only", action="store_true")
args = parser.parse_args()
window = Desktop(backend="uia").window(handle=args.handle)
win32gui.ShowWindow(args.handle, win32con.SW_MAXIMIZE)
if not args.dialog_only:
    window.set_focus()
    window.child_window(title="导入", control_type="Button").wait("enabled visible", timeout=15).click()
deadline = time.monotonic() + 15
while not window.child_window(title="文件名(N):", control_type="Edit").exists():
    if time.monotonic() >= deadline:
        raise RuntimeError("原生文件选择对话框未就绪")
    time.sleep(0.1)
window.child_window(title="文件名(N):", control_type="Edit").set_edit_text(str(Path(args.file).resolve()))
window.child_window(auto_id="1", class_name="Button").wrapper_object().iface_invoke.Invoke()
window.child_window(title="文件名(N):", control_type="Edit").wait_not("exists", timeout=15)
print("真实扩展管理器已选择安装包")
