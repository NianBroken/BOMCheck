"""扩展安装包导入的 Windows 原生对话框测试入口。
控件由当前窗口树识别，路径来自参数，不预设用户磁盘目录。
成功输出只说明对话框流程完成，文件内容及业务结果由调用方继续回读核验。
脚本只把指定 `.eext` 路径提交给真实扩展管理器，不判断安装结果，安装状态由后续宿主检查确认。"""
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
parser.add_argument("--file", required=True)
parser.add_argument("--dialog-only", action="store_true")
args = parser.parse_args()
# 只绑定指定窗口，恢复为最大化后继续同一个原生对话框流程。
window = Desktop(backend="uia").window(handle=args.handle)
win32gui.ShowWindow(args.handle, win32con.SW_MAXIMIZE)
# 需要主动打开时才聚焦并触发按钮，已开对话框时跳过该步以避免焦点返回导致取消。
if not args.dialog_only:
    window.set_focus()
    window.child_window(title="导入", control_type="Button").wait("enabled visible", timeout=15).click()
# 在限定时间内等待文件名输入出现，不对尚未打开的对话框发送输入。
deadline = time.monotonic() + 15
while not window.child_window(title="文件名(N):", control_type="Edit").exists():
    if time.monotonic() >= deadline:
        raise RuntimeError("原生文件选择对话框未就绪")
    time.sleep(0.1)
# 只把已提供安装包路径写入原生文件名框，随后调用真实确认按钮。
window.child_window(title="文件名(N):", control_type="Edit").set_edit_text(str(Path(args.file).resolve()))
window.child_window(auto_id="1", class_name="Button").wrapper_object().iface_invoke.Invoke()
window.child_window(title="文件名(N):", control_type="Edit").wait_not("exists", timeout=15)
print("真实扩展管理器已选择安装包")
