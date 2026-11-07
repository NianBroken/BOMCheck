"""物料清单文件选择的 Windows 原生对话框测试入口。
控件由当前窗口树识别，路径来自参数，不预设用户磁盘目录。
成功输出只说明对话框流程完成，文件内容及业务结果由调用方继续回读核验。
dialog-only 模式专门处理已经打开的系统对话框，普通模式才由脚本点击扩展中的导入按钮。"""
import argparse
import sys
import time
from pathlib import Path
import win32con
import win32gui
from pywinauto import Desktop

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
# 目标句柄和文件路径由测试调用者提供，dialog-only 表示对话框已由其他入口打开。
parser = argparse.ArgumentParser()
parser.add_argument("--handle", type=int, required=True)
parser.add_argument("--file", required=False)
parser.add_argument("--dialog-only", action="store_true")
args = parser.parse_args()
# 只绑定指定窗口，恢复为最大化后继续同一个原生对话框流程。
window = Desktop(backend="uia").window(handle=args.handle)
win32gui.ShowWindow(args.handle, win32con.SW_MAXIMIZE)
# 需要主动打开时才聚焦并触发按钮，已开对话框时跳过该步以避免焦点返回导致取消。
if not args.dialog_only:
    window.set_focus()
    window.child_window(auto_id="choose", control_type="Button").wait("exists enabled visible", timeout=15).click()
# 在限定时间内等待文件名输入出现，不对尚未打开的对话框发送输入。
deadline = time.monotonic() + 15
while not window.child_window(title="文件名(N):", control_type="Edit").exists():
    if time.monotonic() >= deadline:
        raise RuntimeError("原生文件选择对话框未就绪")
    time.sleep(0.1)
# 提供文件时输入规范化绝对路径并确认，未提供文件时点击取消，二者都等待对话框真正关闭。
if args.file:
    window.child_window(title="文件名(N):", control_type="Edit").set_edit_text(str(Path(args.file).resolve()))
    window.child_window(auto_id="1", class_name="Button").wrapper_object().iface_invoke.Invoke()
else:
    window.child_window(title="取消", control_type="Button").click()
window.child_window(title="文件名(N):", control_type="Edit").wait_not("exists", timeout=15)
print("真实文件对话框已完成选择")
