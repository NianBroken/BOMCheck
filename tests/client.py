"""通过官方CLI调用真实编辑器，使用ASCII传输保护中文脚本与结果的字符边界。"""
import argparse
import json
import pathlib
import subprocess
import tempfile


def invoke(client: str, session: str, source: str, timeout: int) -> dict:
    """业务代码仍为UTF-8，CLI传输层用JavaScript Unicode转义保留全部字符。"""
    def escape(character: str) -> str:
        code = ord(character)
        if code < 128:
            return character
        return f'\\u{code:04x}' if code <= 0xFFFF else f'\\u{{{code:x}}}'

    body = ''.join(escape(character) for character in source)
    wrapper = 'const __bomcheckResult = await (async()=>{\n' + body + r'''
})();
return JSON.stringify(__bomcheckResult).replace(/[^\x00-\x7F]/g, character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
'''
    if len(wrapper.encode('ascii')) > 1048576:
        raise ValueError('客户端联调脚本超过官方CLI容量，请缩小输入数据')
    with tempfile.TemporaryDirectory(prefix='bomcheck-cli-') as temporary:
        code_file = pathlib.Path(temporary) / 'invoke.js'
        code_file.write_text(wrapper, encoding='utf-8')
        result = subprocess.run([client, 'invoke', '--session', session, '--code-file', str(code_file),
                                 '--timeout', str(timeout)], capture_output=True,
                                timeout=timeout / 1000 + 20, encoding='utf-8', errors='strict')
    response = json.loads(result.stdout)
    if response.get('ok') and isinstance(response.get('value'), str):
        response['value'] = json.loads(response['value'])
    if result.stderr.strip():
        response['stderr'] = result.stderr.strip()
    return response


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
