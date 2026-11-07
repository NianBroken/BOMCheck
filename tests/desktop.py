"""通过 Windows UI Automation 操作指定测试窗口，并保存可核对的控件与截图。"""

import argparse
import json
import sys
import time
from pathlib import Path

import win32api
import win32con
import win32gui
from pywinauto import Desktop
from pywinauto.keyboard import send_keys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def describe(control):
    """保留控件名称、类型和实际屏幕位置，供界面操作定位使用。"""
    rect = control.rectangle()
    return {
        "name": control.window_text(),
        "type": control.element_info.control_type,
        "id": control.element_info.automation_id,
        "rect": [rect.left, rect.top, rect.right, rect.bottom],
        "enabled": control.is_enabled(),
        "visible": control.is_visible(),
    }


def main():
    """每次调用只执行一个明确动作，避免依赖未经观察的界面状态。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("action", choices=["windows", "tree", "shot", "click", "keys", "text", "toggle", "select"])
    parser.add_argument("--handle", type=int)
    parser.add_argument("--name")
    parser.add_argument("--kind")
    parser.add_argument("--id")
    parser.add_argument("--index", type=int, default=0)
    parser.add_argument("--x", type=int)
    parser.add_argument("--y", type=int)
    parser.add_argument("--value")
    parser.add_argument("--path")
    parser.add_argument("--background", action="store_true")
    args = parser.parse_args()
    desktop = Desktop(backend="uia")
    if args.action == "windows":
        result = [dict(describe(w), handle=w.handle, pid=w.process_id()) for w in desktop.windows()]
    else:
        window = desktop.window(handle=args.handle).wrapper_object()
        # 宿主在后台会延后绘制，切换到目标窗口后等待一帧完整界面再定位控件。
        if args.action not in ["tree"] and win32gui.GetForegroundWindow() != args.handle:
            window.set_focus()
            time.sleep(1)
        if args.action == "tree":
            result = [dict(describe(c), index=i) for i, c in enumerate(window.descendants())]
        elif args.action == "shot":
            window.set_focus()
            path = Path(args.path)
            path.parent.mkdir(parents=True, exist_ok=True)
            window.capture_as_image().save(path)
            result = {"path": str(path.resolve()), "window": describe(window)}
        elif args.action == "click":
            if args.x is not None:
                window.set_focus()
                window.click_input(coords=(args.x, args.y))
            else:
                deadline = time.monotonic() + 8
                while True:
                    controls = window.descendants(control_type=args.kind) if args.kind else window.descendants()
                    candidates = [c for c in controls if (not args.id or c.element_info.automation_id == args.id) and (not args.name or c.window_text() == args.name) and c.is_enabled()]
                    if len(candidates) > args.index or time.monotonic() >= deadline:
                        break
                    time.sleep(0.15)
                if len(candidates) <= args.index:
                    raise RuntimeError(f"当前窗口没有可操作控件：{args.name}")
                control = candidates[args.index]
                if control.element_info.control_type == "Button":
                    control.click()
                elif args.background:
                    rect = control.rectangle()
                    point = win32gui.ScreenToClient(args.handle, (rect.mid_point().x, rect.mid_point().y))
                    position = win32api.MAKELONG(*point)
                    win32gui.PostMessage(args.handle, win32con.WM_MOUSEMOVE, 0, position)
                    win32gui.PostMessage(args.handle, win32con.WM_LBUTTONDOWN, win32con.MK_LBUTTON, position)
                    win32gui.PostMessage(args.handle, win32con.WM_LBUTTONUP, 0, position)
                else:
                    window.set_focus()
                    control.click_input()
            result = {"action": args.action, "completed": True}
        elif args.action == "toggle":
            candidates = [c for c in window.descendants() if c.element_info.control_type == "CheckBox" and (not args.name or c.window_text() == args.name)]
            control = candidates[args.index]
            if control.get_toggle_state() != int(args.value):
                control.toggle()
            result = {"action": args.action, "state": control.get_toggle_state()}
        elif args.action == "select":
            # 下拉框通过系统选择接口触发真实表单事件，选项名称来自当前控件树。
            candidates = [c for c in window.descendants() if c.element_info.control_type == "ComboBox" and (not args.name or c.window_text() == args.name) and (not args.id or c.element_info.automation_id == args.id)]
            control = candidates[args.index]
            control.expand()
            deadline = time.monotonic() + 8
            while True:
                entries = [c for c in window.descendants(control_type="ListItem") if c.window_text() == args.value]
                if entries or time.monotonic() >= deadline:
                    break
                time.sleep(0.1)
            if not entries:
                raise RuntimeError(f"当前下拉框没有选项：{args.value}")
            entries[-1].select()
            result = {"action": args.action, "selected": args.value}
        elif args.action == "text":
            deadline = time.monotonic() + 8
            while True:
                candidates = [c for c in window.descendants() if (not args.name or c.window_text() == args.name) and (not args.id or c.element_info.automation_id == args.id) and c.element_info.control_type == "Edit"]
                if len(candidates) > args.index or time.monotonic() >= deadline:
                    break
                time.sleep(0.15)
            if len(candidates) <= args.index:
                raise RuntimeError(f"当前窗口没有文本输入框：{args.name}")
            candidates[args.index].set_edit_text(args.value)
            result = {"action": args.action, "completed": True}
        else:
            window.set_focus()
            send_keys(args.value, with_spaces=True, vk_packet=True)
            result = {"action": args.action, "completed": True}
    print(json.dumps(result, ensure_ascii=True))


if __name__ == "__main__":
    main()
