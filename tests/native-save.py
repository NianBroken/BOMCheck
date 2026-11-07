"""通过实际宿主保存对话框导出文件，路径由测试调用方明确提供。"""
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
parser.add_argument("--button", default="export")
parser.add_argument("--dialog-only", action="store_true")
args = parser.parse_args()
window = Desktop(backend="uia").window(handle=args.handle)
win32gui.ShowWindow(args.handle, win32con.SW_MAXIMIZE)
if not args.dialog_only:
    window.set_focus()
    window.child_window(auto_id=args.button, control_type="Button").wait("exists enabled visible", timeout=15).click()
deadline = time.monotonic() + 15
while True:
    edits = [e for e in window.descendants(control_type="Edit") if "文件名" in e.window_text()]
    if edits:
        break
    if time.monotonic() >= deadline:
        raise RuntimeError("宿主保存对话框未就绪")
    time.sleep(0.1)
edits[-1].set_edit_text(str(Path(args.file).resolve()))
window.child_window(title="保存(S)", control_type="Button").click()
window.child_window(title="保存(S)", control_type="Button").wait_not("exists", timeout=15)
print("实际保存对话框已完成导出")
