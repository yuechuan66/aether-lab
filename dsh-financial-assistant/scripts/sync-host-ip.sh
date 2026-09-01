#!/usr/bin/env bash
# sync-host-ip.sh — 同步 Colima 宿主网桥 IP 到本地验证配置。
#
# 背景：本地容器验证时，模型网关跑在 macOS 宿主（只监听 127.0.0.1）。
# Colima(vz) 自带转发：容器内访问 host.lima.internal（通常 192.168.5.2）
# 会直接到达宿主的 loopback 服务——**无需任何代理/转发进程**。
# 只需把 settings.yaml 的 baseURL 指向该 IP。VM 重建后 IP 可能变化，
# 届时跑一次本脚本即可。
#
# 用法：
#   scripts/sync-host-ip.sh            # 解析网桥 IP 并更新 config/settings.yaml
#   scripts/sync-host-ip.sh --print    # 只打印 IP，不改文件
#
# 环境变量：
#   GATEWAY_PORT   宿主网关端口（默认 15721）
#   SETTINGS_FILE  目标配置（默认 config/settings.yaml）

set -euo pipefail

GATEWAY_PORT="${GATEWAY_PORT:-15721}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SETTINGS_FILE="${SETTINGS_FILE:-$ROOT/config/settings.yaml}"

log() { printf '[sync-host-ip] %s\n' "$*"; }
die() { printf '[sync-host-ip] ERROR: %s\n' "$*" >&2; exit 1; }

command -v colima >/dev/null 2>&1 || die "缺少 colima"
colima status >/dev/null 2>&1 || die "Colima 未运行，先执行：colima start"

IP="$(colima ssh -- getent hosts host.lima.internal 2>/dev/null | awk '{print $1}' | head -1)"
[[ -n "$IP" ]] || die "解析不到 host.lima.internal 的 IP"

if [[ "${1:-}" == "--print" ]]; then
  echo "$IP"
  exit 0
fi

if [[ ! -f "$SETTINGS_FILE" ]]; then
  die "未找到 $SETTINGS_FILE"
fi

# 替换指向本网关端口的任意 IP（覆盖旧网桥地址）。
if grep -Eq "baseURL: \"http://[0-9.]+:$GATEWAY_PORT/v1\"" "$SETTINGS_FILE"; then
  sed -i '' -E "s#baseURL: \"http://[0-9.]+:$GATEWAY_PORT/v1\"#baseURL: \"http://$IP:$GATEWAY_PORT/v1\"#" "$SETTINGS_FILE"
  log "baseURL 已更新为 http://$IP:$GATEWAY_PORT/v1 (${SETTINGS_FILE})"
  log "重启容器生效：docker restart dsh-financial-assistant"
else
  log "settings 里没有指向 :$GATEWAY_PORT 的 baseURL，未改动"
  log "若需本地网关验证，请手动把 baseURL 设为 http://$IP:$GATEWAY_PORT/v1"
fi
