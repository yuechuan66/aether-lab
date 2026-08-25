#!/usr/bin/env bash
# 重启 DSH + flow-tracer 插件。
# 用法：npm run restart [额外 dsh 参数，如 --no-open]
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> 停止旧进程…"
pkill -f "dsh web" 2>/dev/null || true
pkill -f "dsh --profile" 2>/dev/null || true
sleep 2

echo "==> 释放端口…"
lsof -ti:9527 | xargs kill -9 2>/dev/null || true
lsof -ti:3080 | xargs kill -9 2>/dev/null || true
sleep 1

echo "==> 启动 DSH + flow-tracer…"
exec dsh web --patch ./plugin.patch.yml "$@"
