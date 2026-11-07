"""根据真实客户端回传的视口坐标拖动悬浮滑块，保留实际截图。"""
import argparse
import json
import sys
import time
from pathlib import Path
import win32gui
from pywinauto import Desktop, mouse

sys.stdout.reconfigure(encoding="utf-8")
parser = argparse.ArgumentParser()
parser.add_argument("--handle", type=int, required=True)
parser.add_argument("--label", required=True)
args = parser.parse_args()
root = Path("tests/output")
def value(name):
    return json.loads((root / name).read_text(encoding="utf-8"))["result"]["result"]["value"]
viewport = value(f"seven-scroll-coordinates{args.label}.json")
frame = value(f"seven-frame{args.label}.json")
window = Desktop(backend="uia").window(handle=args.handle).wrapper_object()
window.set_focus()
origin = win32gui.ClientToScreen(args.handle, (0, 0))
def point(x, y):
    return (round(origin[0] + (frame["frame"]["x"] + x) * frame["scale"]), round(origin[1] + (frame["frame"]["y"] + y) * frame["scale"]))
holder = viewport["holder"]
mouse.move(coords=point(holder["x"] + 100, holder["y"] + 50))
time.sleep(0.3)
for axis, distance in [(0, 180), (1, 60)]:
    bar = viewport["bars"][axis]["handle"]
    start = point(bar["x"] + bar["width"] / 2, bar["y"] + bar["height"] / 2)
    end = (start[0] + (distance if axis == 0 else 0), start[1] + (distance if axis == 1 else 0))
    mouse.move(coords=start)
    time.sleep(0.1)
    mouse.press(coords=start)
    try:
        for step in range(1, 10):
            mouse.move(coords=(round(start[0] + (end[0] - start[0]) * step / 9), round(start[1] + (end[1] - start[1]) * step / 9)))
            time.sleep(0.03)
    finally:
        mouse.release(coords=end)
    time.sleep(0.15)
window.capture_as_image().save(root / f"screenshots/seven-scroll-drag{args.label}.png")
print(json.dumps({"label": args.label, "horizontalDrag": 180, "verticalDrag": 60}))
