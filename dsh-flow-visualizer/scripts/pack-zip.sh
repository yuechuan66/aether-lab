#!/usr/bin/env bash
# 生成 npm 规格的分发包：.tgz + .zip（package/ 布局，内容 = files 字段）
# 用法：npm run dist
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "==> 构建后端 + 前端…"
npm run build

echo "==> npm pack…"
npm pack

VERSION=$(node -p "require('./package.json').version")
TGZ="dsh-plugin-flow-tracer-${VERSION}.tgz"
ZIP="dsh-plugin-flow-tracer-${VERSION}.zip"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
tar -xzf "$TGZ" -C "$WORK"
# zip 根目录即包内容（无 package/ 外层目录）
(cd "$WORK/package" && zip -rq "$ROOT/$ZIP" . -x ".*")

echo "==> 产物："
ls -lh "$ROOT/$TGZ" "$ROOT/$ZIP"
