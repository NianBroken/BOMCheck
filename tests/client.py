"""通过官方 CLI 调用显式指定的真实编辑器会话。
业务脚本读取和报告写入使用 UTF-8，传输时将非 ASCII 文字转义以保留字符边界。
此入口只组织测试调用，具体工程访问由传入脚本执行。"""
import argparse
import json
import pathlib
import subprocess
import tempfile


# 将源码包装成异步函数体，再由 CLI 返回 JSON 文本。
# 输入超出一兆字节上限时在启动子进程前拒绝，临时代码文件在调用结束后清理。
def invoke(client: str, session: str, source: str, timeout: int) -> dict:
    """业务代码仍为UTF-8，CLI传输层用JavaScript Unicode转义保留全部字符。
    返回值是官方 CLI 的完整响应字典，调用方可以据此区分宿主拒绝、脚本异常和业务结果。"""
    # 基本多文种字符使用四位 Unicode 转义，超出该范围使用花括号码点转义。
    # 原 ASCII 保留原样，不把业务脚本的运算符或换行改成其他语义。
    def escape(character: str) -> str:
        code = ord(character)
        if code < 128:
            return character
        return f'\\u{code:04x}' if code <= 0xFFFF else f'\\u{{{code:x}}}'

    # 逐字符转义后构造完整包装，结果再以 JSON 字符转义保护 CLI 输出中的中文。
    body = ''.join(escape(character) for character in source)
    wrapper = 'const __bomcheckResult = await (async()=>{\n' + body + r'''
})();
return JSON.stringify(__bomcheckResult).replace(/[^\x00-\x7F]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
'''
    if len(wrapper.encode('ascii')) > 1048576:
        raise ValueError('客户端联调脚本超过官方CLI容量，请缩小输入数据')
    # 临时目录只承载当前运行调用脚本，with 在成功和异常路径均释放目录。
    with tempfile.TemporaryDirectory(prefix='bomcheck-cli-') as temporary:
        code_file = pathlib.Path(temporary) / 'invoke.js'
        code_file.write_text(wrapper, encoding='utf-8')
        result = subprocess.run([client, 'invoke', '--session', session, '--code-file', str(code_file),
                                 '--timeout', str(timeout)], capture_output=True,
                                timeout=timeout / 1000 + 20, encoding='utf-8', errors='strict')
    # 保留宿主完整响应，成功结果若为包装返回的 JSON 字符串则再解析一层，避免业务对象在传输层只剩一段字符串。
    # stderr 非空时原样进入报告，不把它作为业务日志丢弃。
    response = json.loads(result.stdout)
    if response.get('ok') and isinstance(response.get('value'), str):
        response['value'] = json.loads(response['value'])
    if result.stderr.strip():
        response['stderr'] = result.stderr.strip()
    return response


# 客户端、会话、脚本路径和报告路径均由命令参数明确传入，避免定位其他编辑窗口。
def main() -> None:
    """显式指定客户端和测试会话，避免误操作用户正在编辑的其他窗口。"""
    parser = argparse.ArgumentParser()
    parser.add_argument('--client', required=True)
    parser.add_argument('--session', required=True)
    parser.add_argument('--script', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--timeout', type=int, default=180000)
    options = parser.parse_args()
    script = pathlib.Path(options.script).read_text(encoding='utf-8')
    response = invoke(options.client, options.session, script, options.timeout)
    pathlib.Path(options.output).write_text(json.dumps(response, ensure_ascii=False, indent=2), encoding='utf-8')
    print(json.dumps({key: value for key, value in response.items() if key != 'value'}, ensure_ascii=False))


if __name__ == '__main__':
    main()
