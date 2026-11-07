"""通过真实扩展窗口验证七个页面和文件选择，测试数据按运行隔离。"""
import argparse
import atexit
import csv
import json
import sys
import tempfile
import time
from pathlib import Path
import win32con
import win32gui
from pywinauto import Desktop, mouse
from pywinauto.keyboard import send_keys

def main():
    """窗口标识由调用者提供，页面和按钮名称直接读取项目定义。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--handle', type=int, required=True)
    parser.add_argument('--output')
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    pages = json.loads((root / 'ui/pages.json').read_text(encoding='utf-8'))
    commands = json.loads((root / 'ui/commands.json').read_text(encoding='utf-8'))
    specification = Desktop(backend='uia').window(handle=args.handle)
    window = specification.wrapper_object()
    was_topmost = bool(win32gui.GetWindowLong(args.handle, win32con.GWL_EXSTYLE) & win32con.WS_EX_TOPMOST)
    def restore_position():
        if win32gui.IsWindow(args.handle) and not was_topmost:
            win32gui.SetWindowPos(args.handle, win32con.HWND_NOTOPMOST, 0, 0, 0, 0, win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_NOACTIVATE)
    atexit.register(restore_position)
    def ready_window():
        if win32gui.IsIconic(args.handle):
            win32gui.ShowWindow(args.handle, win32con.SW_RESTORE)
            time.sleep(0.2)
        win32gui.SetWindowPos(args.handle, win32con.HWND_TOPMOST, 0, 0, 0, 0, win32con.SWP_NOMOVE | win32con.SWP_NOSIZE | win32con.SWP_SHOWWINDOW)
        window.set_focus()
    ready_window()
    def click(control, double=False, coords=(None, None)):
        """每次点击前恢复指定窗口，控件位置由当前原生界面提供。"""
        ready_window()
        if double:
            control.double_click_input(coords=coords)
        else:
            control.click_input(coords=coords)
    def scroll(distance, horizontal=False, viewport=None):
        ready_window()
        bounds = (viewport or grid).rectangle()
        point = (bounds.left + bounds.width() // 2, bounds.top + bounds.height() // 2)
        if horizontal:
            send_keys('{VK_SHIFT down}')
        try:
            mouse.scroll(coords=point, wheel_dist=distance)
        finally:
            if horizontal:
                send_keys('{VK_SHIFT up}')
    tabs = {item.window_text(): item for item in window.descendants(control_type='TabItem')}
    assert all(page['title'] in tabs for page in pages), '缺少功能标签页'
    report = {'pages': [], 'fileSelection': False, 'preview': False}
    for page in pages:
        click(tabs[page['title']])
        deadline = time.monotonic() + 10
        while True:
            headings = [item for item in window.descendants(control_type='Text') if item.window_text() == page['title'] and item.is_visible()]
            if len(headings) == 1:
                break
            if win32gui.IsIconic(args.handle):
                click(tabs[page['title']])
            assert time.monotonic() < deadline, page['title']
            time.sleep(0.05)
        report['pages'].append(page['id'])
    click(tabs[pages[0]['title']])
    with tempfile.TemporaryDirectory(prefix='bomcheck-native-') as temporary:
        sample = Path(temporary) / '中文预览验收.csv'
        with sample.open('w', encoding='utf-8-sig', newline='') as stream:
            writer = csv.writer(stream)
            writer.writerow(['位号', '名称', '编号'] + ['扩展字段' + str(number) for number in range(1, 13)])
            writer.writerows([['BOMCHECK_R' + str(index), '中文器件' + str(index), str(index).zfill(6)] + ['完整中文属性' + str(number) for number in range(1, 13)] for index in range(1, 161)])
        button = specification.child_window(title=commands['choose'], control_type='Button').wrapper_object()
        button.click()
        dialog = specification.child_window(title='文件名(N):', control_type='Edit')
        dialog.wait('exists enabled visible', timeout=15)
        dialog.set_edit_text(str(sample))
        specification.child_window(auto_id='1', class_name='Button').wrapper_object().iface_invoke.Invoke()
        dialog.wait_not('exists', timeout=15)
        deadline = time.monotonic() + 15
        while not any(item.window_text() == sample.name for item in window.descendants(control_type='Text')):
            assert time.monotonic() < deadline, '文件读取未完成'
            time.sleep(0.05)
        specification.child_window(title=commands['refresh'], control_type='Button').wait('enabled', timeout=15)
        report['fileSelection'] = True
        click(tabs[pages[1]['title']])
        deadline = time.monotonic() + 15
        while True:
            texts = [item.window_text() for item in window.descendants()]
            if any('有效器件' in text and '160' in text for text in texts):
                break
            assert time.monotonic() < deadline, texts[-30:]
            time.sleep(0.05)
        report['preview'] = True
        grid = specification.child_window(auto_id='preview', control_type='DataGrid').wrapper_object()
        def visible_rows():
            ready_window()
            area = grid.rectangle()
            return [row for row in grid.descendants(control_type='DataItem') if '中文预览验收.csv' in row.window_text() and row.window_text().startswith('BOMCHECK_R') and area.top + 80 <= row.rectangle().top < area.bottom - 30]
        scroll(30, horizontal=True)
        scroll(30)
        initial_filter = grid.descendants(control_type='Edit')[0]
        initial_filter.set_edit_text('')
        deadline = time.monotonic() + 10
        while not visible_rows():
            assert time.monotonic() < deadline, '清除旧筛选后没有显示验收数据'
            time.sleep(0.05)
        before = visible_rows()[0].window_text()
        scroll(-8)
        deadline = time.monotonic() + 10
        while not visible_rows() or visible_rows()[0].window_text() == before:
            assert time.monotonic() < deadline, '纵向滚动未改变可见记录'
            time.sleep(0.05)
        report['verticalScroll'] = True
        first_filter = grid.descendants(control_type='Edit')[0]
        original_left = first_filter.rectangle().left
        scroll(-8, horizontal=True)
        deadline = time.monotonic() + 10
        while first_filter.rectangle().left >= original_left:
            assert time.monotonic() < deadline, '横向滚动未改变列位置'
            time.sleep(0.05)
        report['horizontalScroll'] = True
        scroll(30, horizontal=True)
        scroll(30)
        first_filter.set_edit_text('NO_MATCH')
        deadline = time.monotonic() + 10
        while not any('没有匹配记录' in item.window_text() for item in grid.descendants()):
            assert time.monotonic() < deadline, '筛选空状态未显示'
            time.sleep(0.05)
        click(tabs[pages[5]['title']])
        click(tabs[pages[1]['title']])
        grid = specification.child_window(auto_id='preview', control_type='DataGrid').wrapper_object()
        deadline = time.monotonic() + 10
        while not any('没有匹配记录' in item.window_text() for item in grid.descendants()):
            assert time.monotonic() < deadline, '切页丢失筛选状态'
            time.sleep(0.05)
        first_filter = grid.descendants(control_type='Edit')[0]
        first_filter.set_edit_text('')
        deadline = time.monotonic() + 10
        while not visible_rows():
            assert time.monotonic() < deadline, '清除筛选后没有恢复记录'
            time.sleep(0.05)
        report['filterPreserved'] = True
        click(visible_rows()[0], double=True, coords=(20, 15))
        specification.child_window(auto_id='detail', control_type='Window').wait('visible', timeout=10)
        detail_viewport = specification.child_window(auto_id='detailScroll', control_type='Group').wrapper_object()
        scroll(-8, viewport=detail_viewport)
        close_detail = specification.child_window(title=commands['closeDetail'], control_type='Button')
        close_detail.wait('visible enabled', timeout=10)
        click(close_detail.wrapper_object())
        specification.child_window(auto_id='detail', control_type='Window').wait_not('visible', timeout=10)
        report['detailScroll'] = True
        report['detail'] = True
        if args.output:
            directory = Path(args.output)
            directory.mkdir(parents=True, exist_ok=True)
            window.capture_as_image().save(directory / 'native-preview.png')
            (directory / 'native-ui.json').write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps(report, ensure_ascii=False))

if __name__ == '__main__':
    sys.stdout.reconfigure(encoding='utf-8')
    main()
