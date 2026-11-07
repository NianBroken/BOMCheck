"""通过真实 Windows 控件依次执行验收动作，并保存每步时间和实际状态。"""
import argparse
import json
import sys
import time
from datetime import datetime
from pathlib import Path

import win32gui
from pywinauto import Desktop
from pywinauto.uia_defines import NoPatternInterfaceError
from pywinauto.keyboard import send_keys

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")


def main():
    """流程文件只声明实际控件与输入数据，业务结果由编辑器独立产生。"""
    parser = argparse.ArgumentParser()
    parser.add_argument("--handle", type=int, required=True)
    parser.add_argument("--flow", required=True)
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    window = Desktop(backend="uia").window(handle=args.handle).wrapper_object()
    root = Path.cwd()
    records = []

    def focus():
        if win32gui.GetForegroundWindow() != args.handle:
            window.set_focus()
            time.sleep(0.4)

    def find(kind, name=None, identity=None, index=0):
        deadline = time.monotonic() + 30
        while True:
            controls = [c for c in window.descendants(control_type=kind)
                        if (not identity or c.element_info.automation_id == identity)
                        and (not name or c.window_text() == name) and (kind == "ListItem" or c.is_enabled())]
            if len(controls) > index:
                return controls[index]
            if time.monotonic() >= deadline:
                raise RuntimeError(f"控件没有就绪：{kind} {name or identity}")
            time.sleep(0.15)

    def click(name=None, identity=None):
        find("Button", name, identity).click()

    def select(name, value, index):
        control = find("ComboBox", name=name, index=index)
        control.expand()
        entry = find("ListItem", name=value)
        try:
            entry.select()
        except NoPatternInterfaceError:
            # Chromium 的原生弹出列表没有选择接口时，按实际选项顺序发送标准键盘操作。
            entry.click_input()

    def status():
        bars = window.descendants(control_type="StatusBar")
        return " ".join(child.window_text() for bar in bars for child in bar.children())

    try:
        for step in json.loads(Path(args.flow).read_text(encoding="utf-8")):
            focus()
            if "click" in step:
                click(identity=step["click"])
            elif "button" in step:
                click(name=step["button"])
            elif "file" in step:
                find("Edit", name="文件名(N):").set_edit_text(str((root / step["file"]).resolve()))
                click(name="打开(O)")
            elif "save" in step:
                find("Edit", name="文件名:").set_edit_text(str((root / step["save"]).resolve()))
                click(name="保存(S)")
            elif "map" in step:
                click(identity="addMapping")
                for name, value in zip(["BOM数据列", "工程目标字段"], step["map"]):
                    select(name, value, step.get("index", 0))
            elif "select" in step:
                select(step["select"], step["value"], step.get("index", 0))
            elif "toggle" in step:
                control = find("CheckBox", identity=step["toggle"])
                if control.get_toggle_state() != int(step["value"]):
                    control.toggle()
            elif "edit" in step:
                control = find(step.get("kind", "Edit"), name=step.get("name"), identity=step.get("edit"), index=step.get("index", 0))
                control.set_focus()
                send_keys("^a" + step["value"] + "{TAB}", with_spaces=True, vk_packet=True)
            elif "wait" in step:
                deadline = time.monotonic() + 60
                while step["wait"] not in status():
                    if time.monotonic() >= deadline:
                        raise RuntimeError(f"未到达预期状态：{step['wait']}，实际为：{status()}")
                    time.sleep(0.25)
            elif "dialog" in step:
                find("Text", name=step["dialog"])
            elif "shot" in step:
                path = root / step["shot"]
                path.parent.mkdir(parents=True, exist_ok=True)
                window.capture_as_image().save(path)
            records.append({"time": datetime.now().isoformat(), "step": step, "status": status()})
            print(json.dumps({"step": len(records), "status": records[-1]["status"]}, ensure_ascii=True), flush=True)
    finally:
        Path(args.output).write_text(json.dumps(records, ensure_ascii=False, indent=2), encoding="utf-8")


if __name__ == "__main__":
    main()
