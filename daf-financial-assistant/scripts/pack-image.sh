#!/usr/bin/env bash
# pack-image.sh — 打离线部署包：docker 镜像 + 编排文件 + 配置模板 + 部署说明。
#
# 用法：
#   scripts/pack-image.sh 1.0.0                        # 默认 linux/amd64（生产服务器常见架构）
#   scripts/pack-image.sh 1.0.0 --platform linux/arm64
#
# 产物：dist/daf-financial-assistant-<版本>-<架构>-offline/（目录）+ 同名 .zip
# 接收方按包内 DEPLOY.md 离线部署，无需任何镜像仓库访问。

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VERSION="${1:-}"
[[ -n "$VERSION" ]] || { echo "用法：$0 <版本号> [--platform linux/amd64|linux/arm64]"; exit 1; }

PLATFORM="linux/amd64"
if [[ "${2:-}" == "--platform" ]]; then
  PLATFORM="${3:-}"
  [[ "$PLATFORM" == linux/amd64 || "$PLATFORM" == linux/arm64 ]] || { echo "platform 只能是 linux/amd64 或 linux/arm64"; exit 1; }
fi
ARCH="${PLATFORM#linux/}"

IMAGE="daf-financial-assistant:$VERSION"
NGINX_IMAGE="nginx:1.27-alpine"
DIST="$ROOT/dist/daf-financial-assistant-$VERSION-$ARCH-offline"

echo "==> [1/5] 构建镜像 ${IMAGE} (${PLATFORM}, 跨架构模拟可能较慢)"
docker build --platform "$PLATFORM" -t "$IMAGE" "$ROOT"

echo "==> [2/5] 组装分发目录 $DIST"
rm -rf "$DIST"
mkdir -p "$DIST/config" "$DIST/nginx"

echo "==> [3/5] 导出镜像（daf-server + nginx 打进一个 tar）"
docker save "$IMAGE" "$NGINX_IMAGE" | gzip > "$DIST/images.tar.gz"

echo "==> [4/5] 复制编排与配置模板"
# 离线 compose：image: 直接引用导入的镜像（模板替换版本号）
sed "s/__VERSION__/$VERSION/g" "$ROOT/deploy/docker-compose.offline.yml" > "$DIST/docker-compose.yml"
cp "$ROOT/config/settings.example.yaml" "$DIST/config/settings.example.yaml"
cp "$ROOT/.env.example" "$DIST/.env.example"
cp "$ROOT/nginx/default.conf" "$DIST/nginx/default.conf"
cp "$ROOT/docs/DAF Financial Assistant 服务端部署技术方案.md" "$DIST/技术方案.md" 2>/dev/null || true

cat > "$DIST/DEPLOY.md" <<EOF
# DAF Financial Assistant 离线部署（${VERSION} / ${ARCH}）

## 前置
- Docker Engine + docker compose v2（\`docker compose version\` 可用）
- 架构匹配：本包镜像为 **$PLATFORM**
- **解压目录要放在 Docker 虚拟机可共享的路径**（Colima/Docker Desktop 默认只共享家目录）：
  放在 \`~/\` 下没问题；放 \`/tmp\` 等未共享路径会导致 bind mount 失败
  （报 "not a directory / Are you trying to mount a directory onto a file"）。

## 步骤

\`\`\`bash
# 1) 导入镜像（含 daf-server 与 nginx 两个）
docker load < images.tar.gz
docker images | grep -E "daf-financial-assistant|nginx"   # 确认在列

# 2) 准备配置
cp .env.example .env                    # 填入 DEEPSEEK_API_KEY、DAF_API_KEYS
cp config/settings.example.yaml config/settings.yaml
#  按需调整模型（默认 deepseek-official + deepseek-chat）与权限预设

# 3) 启动
docker compose up -d
docker compose ps                       # 等 daf-server 变 healthy

# 4) 验证（内部纯 HTTP，宿主端口 8080；TLS 由上游统一接入层终结）
curl -s http://127.0.0.1:8080/v1/health
SID=\$(curl -s -X POST http://127.0.0.1:8080/v1/sessions \\
  -H "Authorization: Bearer <你的DAF_API_KEY>" -H 'content-type: application/json' -d '{}' \\
  | sed -E 's/.*"sessionId":"([^"]+)".*/\1/')
curl -s -X POST http://127.0.0.1:8080/v1/sessions/\$SID/messages \\
  -H "Authorization: Bearer <你的DAF_API_KEY>" -H 'content-type: application/json' \\
  -d '{"text":"你好"}'
\`\`\`

## 注意
- **重启 daf-server 必须连带重启 nginx**（共享网络命名空间）：用 \`docker compose up -d\` 或两个都 restart。
- DSH 只监听命名空间内 loopback，对外仅 nginx 的 80（宿主发布为 127.0.0.1:8080，按需改 compose 端口映射）。
- 会话数据在命名卷 \`dsh-sessions\`，\`docker compose down\` 不丢；\`down -v\` 会删。
- 详细设计见包内《技术方案.md》§6/§7/§12。
EOF

echo "==> [5/5] 打 zip"
cd "$ROOT/dist"
rm -f "daf-financial-assistant-$VERSION-$ARCH-offline.zip"
zip -qr "daf-financial-assistant-$VERSION-$ARCH-offline.zip" "daf-financial-assistant-$VERSION-$ARCH-offline"

echo ""
echo "完成："
ls -lh "$ROOT/dist/daf-financial-assistant-$VERSION-$ARCH-offline.zip"
echo "目录：$DIST"
