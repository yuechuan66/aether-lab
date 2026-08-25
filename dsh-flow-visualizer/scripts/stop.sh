#!/usr/bin/env bash
# 停止 DSH + flow-tracer 插件。
# 用法：npm run stop
set -euo pipefail

echo "==> 停止 DSH 进程…"
pkill -f "dsh web" 2>/dev/null || true
pkill -f "dsh --profile" 2>/dev/null || true
sleep 2

echo "==> 释放端口…"
lsof -ti:9527 | xargs kill -9 2>/dev/null || true
lsof -ti:3080 | xargs kill -9 2>/dev/null || true
sleep 1

echo "==> 已停止"
