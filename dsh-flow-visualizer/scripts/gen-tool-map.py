#!/usr/bin/env python3
"""扫描 DSH 源码，生成 工具名 → 插件包名 映射表。

用法：python3 scripts/gen-tool-map.py /path/to/dsh-source
输出生成到 stdout，可直接粘贴进 src/collector.ts 的 KNOWN_TOOL_TO_PLUGIN。
每个 DSH 版本发布后重跑一次以刷新映射。
"""
import json
import os
import re
import sys

# 双归属工具取非 experimental 的主包
PREFERRED = {
    'bash': '@deepseek-ai/dsh-tool-bash',
    'pwsh': '@deepseek-ai/dsh-tool-pwsh',
    'interrupt_agent': '@deepseek-ai/dsh-tool-subagent-control',
    'list_agents': '@deepseek-ai/dsh-tool-subagent-control',
}

PAT = re.compile(r"tools\.register\(\s*defineTool\(\s*\{[^}]{0,400}?name:\s*['\"]([^'\"]+)['\"]", re.S)


def nearest_package(dirpath: str, root: str) -> str | None:
    d = dirpath
    while True:
        pj = os.path.join(d, 'package.json')
        if os.path.exists(pj):
            try:
                return json.load(open(pj, encoding='utf-8')).get('name')
            except Exception:
                return None
        if d == root or d == os.path.dirname(d):
            return None
        d = os.path.dirname(d)


def main() -> None:
    root = os.path.abspath(sys.argv[1] if len(sys.argv) > 1 else '.')
    pkgs = os.path.join(root, 'packages')
    results: dict[str, set[str]] = {}
    for dirpath, dirs, files in os.walk(pkgs):
        if 'node_modules' in dirpath or 'tests' in dirpath:
            continue
        pkg = nearest_package(dirpath, pkgs)
        for f in files:
            if not f.endswith('.ts'):
                continue
            text = open(os.path.join(dirpath, f), encoding='utf-8', errors='ignore').read()
            for m in PAT.finditer(text):
                if pkg:
                    results.setdefault(m.group(1), set()).add(pkg)

    print('/** 内置工具名 → 插件包名映射（scripts/gen-tool-map.py 生成，勿手改） */')
    print('const KNOWN_TOOL_TO_PLUGIN: Record<string, string> = {')
    for tool in sorted(results):
        owners = sorted(results[tool])
        owner = PREFERRED.get(tool, owners[0])
        if len(owners) > 1 and tool not in PREFERRED:
            print(f'  // 多归属: {", ".join(owners)}')
        print(f"  '{tool}': '{owner}',")
    print('}')


if __name__ == '__main__':
    main()
