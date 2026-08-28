# DAF Financial Assistant 服务端部署技术方案

> **项目名称**：daf-financial-assistant
> **基于框架**：DeepSeek Harness (DSH) `0.1.1-rc.2`（registry latest，2026-08 核实）
> **部署模式**：Docker 服务端 + 自研载体插件（Headless API 服务）
> **文档版本**：v2.0 | 2026-08-27（v1.0 假设的 `dsh serve` / REST 端点 / 配置项经核实均不存在，整体重写）

---

## 1. 方案概述

本方案将 **DAF Financial Assistant** 以纯服务端形态部署：Docker 容器内运行 DSH 内核，通过**自研载体插件**对外暴露 REST/SSE API，供自研 Agent 客户端与上游业务系统接入，不内置任何浏览器界面。

### 1.1 为什么不能"直接部署"（v1.0 方案失败原因）

DSH v0.1 定位是**开发态个人 harness**，不是服务框架。经对 `0.1.1-rc.2` 实装核实：

| v1.0 假设 | 实际情况 |
|---|---|
| `dsh serve` 命令 | 不存在。CLI 只有 `dsh web`（浏览器 UI）、`dsh --profile headless "task"`（一次性执行后退出）、`dsh plugin` |
| `/api/v1/health`、`/api/v1/agent/run`、`/ws/agent/stream`、`/mcp` 端点 | 均不存在。web profile 真实 HTTP 面只有 `/api`（浏览器 UI 私有 RPC 桥）、`/plugins`、HMR、SPA 兜底 |
| `dsh.config.yaml`（server/agent/plugins/security/audit） | 整个 schema 不存在。真实配置面 = `$DSH_HOME/settings.yaml` + profile（`package.json` 的 `dsh.profile.bundles` + `cordis.patch.yml`）+ `.credentials.yaml` |
| `DSH_API_KEY` / `DSH_MODEL` / `DSH_HEADLESS` 环境变量 | 均无效。密钥走 `DEEPSEEK_API_KEY`（credentials 解析链）+ `settings.yaml` 的 `llm-deepseek:` 段 |
| `@deepseek-ai/dsh@0.1.3` | 不存在，registry 最新为 `0.1.1-rc.2` |
| webserver 可直接对外 | 官方 README 明示 "This server serves browsers only"；"No TLS, auth, or origin policy — deployment hardening deliberately out of scope for the dev-facing v1" |

### 1.2 为什么插件化改造可行

DSH 架构为"载体扩展"预留了正式接缝：

1. **`ctx.apiProxy`**（`@deepseek-ai/dsh-host-apiproxy`）：完整的服务网关，提供 `session.create` / `session.prompt` / `session.history` / `session.cancel` / `workspace.*` / 事件流（`SessionsApi`/`HostApi`/`EventsApi`）。官方 README 原话：*"This package registers no routes; carriers such as HTTP wrap `ctx.apiProxy` themselves."* —— 路由由载体插件自己注册。
2. **`ctx.webServer`**（`@deepseek-ai/dsh-host-webserver`）：提供 `register(route)`（exact/prefix HTTP 路由）与 `registerUpgrade(route)`（WebSocket upgrade），插件可注册任意路由。
3. **先例**：桌面客户端（CodeMaker Hub）即此模式——`openclaw-gateway` node 进程托管 DSH 内核，监听 `127.0.0.1:18789/18792`，UI 走本地私有通道。本方案做的是同一件事，载体形态换成"对外 REST/SSE + 鉴权"。

### 1.3 设计原则

- **安全优先**：金融数据敏感，鉴权、出站管控在 DSH 之外落实（DSH 本身无此能力）；传输加密由上游统一接入层（TLS）负责
- **边界干净**：客户端对接自定义 REST/SSE 契约，不穿透 DSH 私有协议
- **可审计**：会话 jsonl 持久化 + 事件旁路采集
- **版本锁死**：DSH 内部 API 无稳定承诺，锁版本 + 升级回归

---

## 2. 架构设计

```text
┌────────────────────────────────────────────────────────────┐
│              Docker Host（共享网络命名空间）                  │
│                                                             │
│  ┌──────────────────────────────────────────────────────┐  │
│  │  daf-financial-assistant (Node 22-slim)               │  │
│  │                                                       │  │
│  │  dsh --profile server --host 127.0.0.1 --port 3000    │  │
│  │  ├─ DSH 内核（Cordis composition）                     │  │
│  │  │   ├─ dsh-base（agent loop / session / llm 适配）    │  │
│  │  │   ├─ dsh-web-app（apiProxy 网关 / webserver）       │  │
│  │  │   └─ daf-server-api（自研载体插件）★                │  │
│  │  │        ├─ ctx.webServer.register('/v1/...')        │  │
│  │  │        ├─ API Key 鉴权                              │  │
│  │  │        ├─ ctx.apiProxy: session.create/prompt      │  │
│  │  │        └─ 事件订阅 → SSE 流式推送                    │  │
│  │  └─ @daf/* 金融插件（工具链，装入 profile）             │  │
│  │                                                       │  │
│  │  DSH 只监听 netns 内 loopback（CLI 拒绝 0.0.0.0）       │  │
│  │       │ 127.0.0.1:3000                                │  │
│  │  ┌────▼───────────────────────────┐                  │  │
│  │  │ nginx（同 netns，限流）          │                  │  │
│  │  │ 仅放行 /v1/，其余 404            │                  │  │
│  │  └────┬───────────────────────────┘                  │  │
│  └───────┼──────────────────────────────────────────────┘  │
│          │ :80（发布为宿主 127.0.0.1:8080）                  │
│  /app/.dsh (volume: sessions/审计)  settings.yaml (ro)      │
└──────────┼─────────────────────────────────────────────────┘
           ▲ HTTP / SSE（TLS 由上游统一接入层终结）
   自研 Agent 客户端 / 业务系统 / 风控平台
```

---

## 3. 项目目录结构

```text
daf-financial-assistant/
├── Dockerfile                    # 两阶段构建（§6）
├── docker-compose.yml            # 开发/自建编排（§7）
├── .dockerignore
├── .env / .env.example           # 敏感配置 ⚠️ .env 入 .gitignore
├── dsh-home/                     # 打进镜像的 $DSH_HOME 骨架
│   └── profiles/server/          # server profile（bundles + file: 插件依赖）
├── plugins/
│   └── daf-server-api/           # 自研载体插件（src/*.ts → lib/index.js）
├── deploy/
│   └── docker-compose.offline.yml # 离线包专用 compose 模板（image: 引用）
├── config/
│   ├── settings.yaml             # 运行时挂载（本地验证配置）
│   └── settings.example.yaml     # 生产模板（deepseek-official）
├── nginx/
│   └── default.conf              # 纯 HTTP 反代 + 限流（§8）
├── scripts/
│   ├── pack-image.sh             # 打离线部署包
│   └── sync-host-ip.sh           # 本地验证：同步宿主网关网桥 IP
└── docs/
    └── 本技术方案
```

---

## 4. 自研载体插件设计（daf-server-api）★ 核心工作量

Cordis 插件，注入 `ctx.webServer` + `ctx.apiProxy`，注册对外路由。

### 4.1 对外 API 契约（自定义，客户端只依赖此层）

| 方法 | 路径 | 说明 | 映射到 apiProxy |
|---|---|---|---|
| GET | `/v1/health` | 健康检查（进程存活 + 内核 settled） | — |
| POST | `/v1/sessions` | 创建会话，返回 `sessionId` | `session.create` |
| POST | `/v1/sessions/{id}/messages` | 发送用户消息；`Accept: text/event-stream` 时以 SSE 流式返回本轮事件，否则阻塞返回最终文本 | `session.prompt` + 事件订阅 |
| GET | `/v1/sessions/{id}/events` | SSE 订阅会话事件流（断线重连用） | `EventsApi` 订阅 |
| GET | `/v1/sessions/{id}/history` | 分页历史 | `session.history` |
| POST | `/v1/sessions/{id}/cancel` | 中止当前轮 | `session.cancel` |

鉴权：`Authorization: Bearer <api-key>`，插件路由入口统一校验（key 从环境变量注入，启动时加载）。传输加密由上游统一接入层（TLS）负责，容器内为纯 HTTP。

### 4.2 实现要点

- 路由注册：`ctx.webServer.register({ path: '/v1/...', ... })`；路径与官方 `/api`、`/plugins` 不冲突（重复注册会抛错，属预期保护）。
- 流式：SSE 优于 WS（单向、可过反代、客户端简单）；事件源为 apiProxy 的事件订阅（与浏览器 UI 的 mux 帧同源）。
- 审计：所有请求/响应 + 会话事件落 JSONL（`/app/.dsh` 内 session jsonl 持久化是内核自带的，载体层再补一条接入方维度的审计线）。
- 并发：单进程多会话由内核支持（`ctx.agents` 按 sessionId 隔离），**上线前必须压测**确认并发上限。

### 4.3 金融工具插件

`@daf/financial-calculator`、`@daf/market-data-fetcher`、`@daf/compliance-checker` 按标准 DSH 插件形态开发（`dsh.bundle.patch` 声明），通过 profile `dependencies` 装入——无需 `allowed_list` 这类不存在的配置，**不装进 profile 就是最有效的白名单**。

---

## 5. DSH 真实配置面

### 5.1 server profile —— `dsh-home/profiles/server/package.json`

```json
{
  "name": "dsh-profile-server",
  "private": true,
  "dependencies": {
    "@daf/dsh-server-api": "^0.1.0",
    "@daf/financial-calculator": "^0.1.0",
    "@daf/market-data-fetcher": "^0.1.0",
    "@daf/compliance-checker": "^0.1.0"
  },
  "dsh": {
    "profile": {
      "bundles": [
        "@deepseek-ai/dsh-base",
        "@deepseek-ai/dsh-web-app",
        "@daf/dsh-server-api"
      ]
    }
  }
}
```

> `dsh-base` / `dsh-web-app` 随 dsh 安装包解析（two-anchored），无需写进 dependencies。
> `dsh-web-app` 提供 `api-gateway`（apiProxy）与 `webserver` 条目；前端 dist 会一并兜底服务，无害，联调期可直连浏览器排查，稳定后可评估裁剪。

### 5.2 profile patch —— `dsh-home/profiles/server/cordis.patch.yml`

```yaml
# 留空数组：host/port 走 CLI 参数（见 Dockerfile CMD）。
[]
```

> ⚠️ **不要配 `host: "0.0.0.0"`**：DSH CLI 明确拒绝非 loopback 绑定（"intentionally not supported yet for safety: it would expose remote code execution to the network"）。对外暴露由 nginx 共享网络命名空间解决（§7），DSH 永远只监听 127.0.0.1。

### 5.3 `dsh-home/settings.yaml`

```yaml
llm-deepseek:
  baseURL: https://api.deepseek.com
  apiKeyEnv: DEEPSEEK_API_KEY   # 每请求经 credentials 链解析：继承环境变量 > .credentials.yaml

agent-default-model:
  provider: deepseek-official
  model: deepseek-chat
```

> settings.yaml 热加载；`llm-deepseek:` / `agent-default-model:` 段覆盖 base bundle 默认条目（已核实条目 id）。

### 5.4 凭据

容器内直接注入环境变量 `DEEPSEEK_API_KEY`（credentials 解析链中"继承环境变量"优先级最高），**不**在镜像内落 `.credentials.yaml`。

---

## 6. Dockerfile（已构建验证 ✅）

以仓库根目录 `Dockerfile` 为准（2026-08-27 在 Colima + Docker 29 实测构建通过）。关键设计与踩坑修复：

```dockerfile
# ---- Build stage: 装 dsh，组装 $DSH_HOME（server profile + 插件）----
FROM node:22-slim AS builder
RUN npm config set registry https://registry.npmjs.org/ \
    && npm install -g @deepseek-ai/dsh@0.1.1-rc.2 pnpm@9
WORKDIR /build/repo
COPY plugins/ plugins/
COPY dsh-home/ dsh-home/
# 镜像内构建载体插件（TS -> lib/index.js）
RUN cd plugins/daf-server-api \
    && npm install --no-save esbuild@0.25 \
    && ./node_modules/.bin/esbuild src/index.ts --bundle --platform=node --format=esm --outfile=lib/index.js
# 物化 server profile（file: 依赖把构建好的插件拷入）
ENV DSH_HOME=/build/repo/dsh-home
RUN cd dsh-home/profiles/server && pnpm install

# ---- Production stage ----
FROM node:22-slim
RUN groupadd -r daf && useradd -r -g daf -d /app -s /sbin/nologin daf \
    && apt-get update && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/* \
    && mkdir -p /app/workspace && chown -R daf:daf /app
# ⚠️ 坑1：COPY 会把 npm bin 符号链接解引用成普通文件，必须重建软链——
# 否则 ESM 从 /usr/local/bin 向上解析，找不到 @deepseek-ai/* 依赖（ERR_MODULE_NOT_FOUND）
COPY --from=builder /usr/local/lib/node_modules/@deepseek-ai/dsh \
                    /usr/local/lib/node_modules/@deepseek-ai/dsh
RUN ln -sf ../lib/node_modules/@deepseek-ai/dsh/lib/bin.js /usr/local/bin/dsh
# ⚠️ 坑2：$DSH_HOME 必须 daf 属主（启动要写 profiles/node_modules 与 sessions）
COPY --from=builder --chown=daf:daf /build/repo/dsh-home /app/.dsh
# ⚠️ 坑3：命名卷首次挂载从镜像路径继承属主——路径不存在会变成 root，
# daf 写不进 sessions 会导致轮次静默空转。必须镜像内预建
RUN mkdir -p /app/.dsh/sessions && chown daf:daf /app/.dsh/sessions

WORKDIR /app
USER daf
ENV DSH_HOME=/app/.dsh DAF_WORKSPACE=/app/workspace NODE_ENV=production TZ=Asia/Shanghai
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD node -e "fetch('http://localhost:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
EXPOSE 3000
# ⚠️ 坑4：只能 127.0.0.1——DSH CLI 拒绝 0.0.0.0（防 RCE 暴露），对外由 nginx 共享 netns 解决（§7）
CMD ["dsh", "--profile", "server", "--host", "127.0.0.1", "--port", "3000", "--no-open"]
```

---

## 7. docker-compose.yml（已起栈验证 ✅）

以仓库根目录 `docker-compose.yml` 为准。**核心设计：nginx 共享 daf-server 的网络命名空间**——因为 DSH 拒绝绑定非 loopback（§6 坑4），DSH 永远只听 127.0.0.1，对外流量一律经同 netns 内的 nginx（仅放行 `/v1/`）。

```yaml
services:
  daf-server:
    build: { context: ., dockerfile: Dockerfile }
    container_name: daf-financial-assistant
    restart: unless-stopped
    env_file: .env
    ports:
      # nginx 与本服务共享 netns，80 由同 netns 内的 nginx 监听。
      # TLS 由上游统一接入层终结，内部纯 HTTP。
      - "127.0.0.1:8080:80"
      # 注：DSH 在 netns 内只绑 loopback，发布 3000 不可达（有意如此）。
    volumes:
      - ./config/settings.yaml:/app/.dsh/settings.yaml:ro
      - dsh-sessions:/app/.dsh/sessions
    deploy:
      resources: { limits: { memory: 4G, cpus: "4.0" } }
    logging:
      driver: json-file
      options: { max-size: "50m", max-file: "10" }
    security_opt: [ "no-new-privileges:true" ]

  nginx:
    image: nginx:1.27-alpine
    container_name: daf-nginx
    restart: unless-stopped
    network_mode: service:daf-server     # ← 共享 daf-server 的 netns
    depends_on: [ daf-server ]
    volumes:
      - ./nginx/default.conf:/etc/nginx/conf.d/default.conf:ro

volumes:
  dsh-sessions:
```

> **运维注意**：`network_mode: service:` 下，重启/重建 daf-server 会重建网络命名空间，nginx 会滞留在旧 netns（连接失败）。**重启 daf-server 后必须一并重启 nginx**（`docker compose up -d` 会处理）。
> `deploy.resources.reservations` 在非 swarm compose 下被忽略，已移除；`limits` Compose v2 生效。

### .env

```bash
# ===== DeepSeek API =====
DEEPSEEK_API_KEY=sk-xxxxxxxxxxxxxxxxxxxxxxxx

# ===== 载体插件 =====
DAF_API_KEYS=<接入方 api-key 列表，逗号分隔>
DAF_AUDIT_LOG=true

TZ=Asia/Shanghai
```

---

## 8. nginx（纯 HTTP + 限流）

> **TLS 由上游统一接入层终结**，容器内这段是纯 HTTP。以仓库 `nginx/default.conf` 为准：

```nginx
limit_req_zone $binary_remote_addr zone=daf:10m rate=10r/s;

server {
    listen 80;
    server_name daf.internal.example.com;

    location /v1/ {
        # 与 daf-server 共享网络命名空间，直接走 loopback。
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Connection '';      # SSE 必需
        proxy_buffering off;                  # SSE 必需
        proxy_cache off;
        proxy_read_timeout 600s;              # 长轮次
        proxy_send_timeout 600s;
        limit_req zone=daf burst=20 nodelay;
    }

    # 其余路径（含 DSH 浏览器 UI 兜底）一律不暴露。
    location / {
        return 404;
    }
}
```

---

## 9. 安全合规清单（v2.0：按真实能力重列）

| 风险类别 | 控制措施 | 落实位置 | 状态 |
|---------|---------|---------|------|
| API Key 泄露 | 运行时环境变量注入，不入镜像 | `.env` + `env_file` | ✅ 可落地 |
| 接入方鉴权 | Bearer API Key 校验（fail-closed） | 自研载体插件 | ✅ 已验证（Phase 1） |
| 传输加密 | TLS 由上游统一接入层终结（容器内纯 HTTP） | 上游接入层 | ✅ 架构确定；接入层配置归平台 |
| 容器逃逸 | 非 root + no-new-privileges | Dockerfile + compose | ✅ 已验证（镜像实跑） |
| 公网暴露 | 仅绑 127.0.0.1，nginx 只放行 `/v1/`，共享 netns | compose + nginx | ✅ 已验证（含 404 围栏） |
| 出站网络 | 容器网络层管控（见 §11 限制 3） | Docker network / 前置代理 | ⚠️ 需额外设施 |
| 恶意命令执行 | 沙箱（macOS Seatbelt / Linux bwrap+Landlock）+ 审批闭环（`/v1/approvals`）；fail-closed | DSH sandbox + 载体插件 | ✅ 审批闭环 + 容器内 Landlock 均已验证 |
| 插件供应链 | 只装构建期声明的插件，无运行时安装 | profile dependencies | ✅ 可落地 |
| 操作审计 | 内核 session jsonl 持久化 + 审批 `approval/asked`/`decided` 审计事件 | 卷持久化 | 🔨 采集管道待建（Phase 3） |
| 日志爆盘 | 轮转 + 大小限制 | compose logging | ✅ 可落地 |
| 版本漂移 | 锁 `@deepseek-ai/dsh@0.1.1-rc.2` + 升级回归 | Dockerfile | ✅ 可落地 |

---

## 10. 客户端对接（新契约）

| 对接方 | 协议 | 端点 | 认证 |
|-------|------|------|------|
| 自研 Agent 客户端 | REST + SSE | `POST /v1/sessions`、`POST /v1/sessions/{id}/messages`（SSE 流式） | Bearer API Key |
| 内部业务系统 | REST | 同上（阻塞模式，不带 `Accept: text/event-stream`） | Bearer API Key |
| 风控平台 | REST | `GET /v1/sessions/{id}/history` + 审计 JSONl 推送 | Bearer API Key |
| 运维 | REST | `GET /v1/health` | 内网（nginx 白名单） |

> 客户端**不**接触 DSH 私有 `/api` 协议；DSH 升级只影响载体插件内部实现。

---

## 11. 风险与已知限制

1. **内部 API 无稳定承诺**：`ctx.apiProxy` / `ctx.webServer` 均为 DSH 内部契约，无文档化版本承诺。必须锁版本（`0.1.1-rc.2`），每次 DSH 升级先跑回归（重点：apiProxy 方法签名、事件订阅形态、webserver 注册语义）。
2. **并发能力未验证**：单进程多会话有架构支撑（`ctx.agents` 按 sessionId），但无官方容量承诺。Phase 0 即需压测 3/10/30 并发会话。超限后的水平扩容 = 多容器实例 + 会话路由策略（会话持久化是本地卷，需 sticky 路由或共享卷方案）。
3. **出站白名单**：DSH 与 Docker 均无原生域名级出站白名单。`api.deepseek.com` + 内部行情域名的出站管控需要：容器默认网络隔离 + 前置代理（如 squid）做域名白名单，或部署环境（k8s）NetworkPolicy。此项为平台设施，不在本镜像内解决。
4. **单进程风险**：内核异常即服务不可用，依赖 `restart: unless-stopped` + 健康检查兜底；金融级 SLA 需多实例。
5. **前端 dist 暴露**：server profile 复用 `dsh-web-app`，SPA 兜底会服务浏览器 UI。生产可在 nginx 层只放行 `/v1/` 前缀（本方案配置已如此），后续评估裁剪 bundle。

---

## 12. 实施路径

| 阶段 | 内容 | 出口条件 |
|---|---|---|
| **Phase 0（spike，1-2 天）** | 最小载体插件：注册 1 个 POST 路由，调 `session.create` + `session.prompt` 跑固定任务，收事件流返回文本 | 证实 `ctx.apiProxy` 真实签名与事件订阅方式；3 并发会话冒烟 |
| **Phase 1** | 完整契约（§4.1）+ API Key 鉴权 + SSE 流式 + 会话续聊/取消 | 自研客户端端到端跑通多轮对话 |
| **Phase 2** | Docker 镜像 + nginx 反代（纯 HTTP）+ 审计采集 + 压测 | 本文档 §9 清单全部落地 |
| **Phase 3** | @daf/* 金融工具插件接入；出站管控设施；多实例评估 | 生产就绪评审 |

### 12.1 Phase 0 spike 结论（2026-08-27 已验证 ✅）

代码：`plugins/daf-server-api`（TS，esbuild 产出 `lib/index.js`），试验 profile `~/.dsh/profiles/dafspike`（bundles = `dsh-base` + `dsh-web-app` + 本插件，`link:` 本地链接）。

**端到端跑通**：`POST /v1/run {task}` → 创建会话 → prompt → 消费事件流 → 返回模型文本；**3 并发请求各自独立会话、结果正确、真并行**（1+1→2 / 2+2→4 / 3+3→6，各 ~1.4s）。

核实到的真实契约（Phase 1 直接依赖）：

1. **路由注册**：`ctx.webServer.register({ kind: 'exact'|'prefix', path, handler })`，handler 完整持有 req/res（可 SSE 长连接）；重复 (kind,path) 抛错。
2. **RPC 形态**：所有 apiProxy 方法为 `{rpcId, payload}` → `{rpcId, result: {ok:true,value} | {ok:false,error{code,message,details}}}`；`rpcId` 用 `randomUUID()` 即可（brand 仅编译期）。
3. **prompt 是受理式**：`sessions.prompt({sessionId, mode:'queue', content:[{type:'text',text}]})` 只返回 `{accepted:true}`，**结果必须从事件流拿**。
4. **事件订阅**：`events.mux({rpcId,payload:{}}, abortSignal)` → `AsyncIterable<RpcRequest<MuxFrame>>`；mux 是**全会话聚合流**，按 `frame.payload.sessionId` 过滤。
5. **事件结构关键细节**：`SessionEvent = {type, seq, time, data}`，业务载荷在 **`ev.data`** 下（如 `ev.data.message.content[]`，text block 为 `{type:'text', text}`）——不在事件顶层。
6. **轮次边界**：`turn/start` … `assistant/chunk`（流式）… `assistant/message`（终稿）… `turn/end`；以 `turn/end` 收尾。
7. **模型/凭据**：profile 直接复用 `$DSH_HOME/settings.yaml`（`agent-default-model` + provider 段），无需为 server profile 单独配置。

**Phase 1 需注意的设计点**：spike 为每请求开一条 mux 流（N 请求 = N 条全量流），规模化必须改为**单条共享 mux + 按 sessionId 分发**（`Map<sessionId, listeners>`）；`question/requested`（agent 反问）帧需设计客户端应答路径（`ctx.apiProxy.respond`）或超时策略。

### 12.2 Phase 1 结论（2026-08-27 已验证 ✅）

代码：`plugins/daf-server-api@0.1.0`（TS，`src/{index,hub,routes,types}.ts`，esbuild + `tsc` 零错误）。

**已验证能力**（全部端到端实测）：

| 能力 | 验证方式 | 结果 |
|---|---|---|
| 完整 `/v1` 契约 | health / sessions / messages / history / cancel / answers / approvals | ✅ |
| API Key 鉴权 | 无 key→503 fail-closed，错 key→401，health 公开 | ✅ |
| SSE 流式 | `stream:true` → `session/event`×N + `status` + `done` | ✅ |
| 多轮续聊 | turn1 记"42"，turn2 正确召回 | ✅ |
| **冷会话恢复** | 杀进程重启 → 重注册同 sessionId → 记忆保留 | ✅ |
| **反问交互闭环** | agent 触发 ask_user → SSE `question` 帧（带 rpcId）→ `POST /answers` → `question-resolved` → 轮次继续到 `done`（"你的选择是：茶"） | ✅ |
| 中途取消 | 长任务 6s 处 cancel，阻塞调用立即带部分文本返回 | ✅ |
| 共享 mux 分发 | 单条 mux/host 流 + 按 sessionId 分发 + 断流自动重连（替代 spike 的每请求一流） | ✅ |

**新核实的契约事实**：

1. **会话恢复 = 同 sessionId + 同 cwd 再 `create`**；cwd 不一致报 `session-conflict`，但**错误 details 携带 `existingCwd`** —— 插件已实现自动重试，客户端无感。
2. 新会话 cwd 默认取 `DAF_WORKSPACE` 环境变量（缺省为进程 cwd）——生产镜像必须显式设置，保证确定性。
3. 反问应答：`apiProxy.respond({type:'client-response', rpcId:<question 帧的 rpcId>, result:{ok:true, value:{sessionId, answer:{answers:[{id, selected[], custom?}]}}}})`；receipt `{accepted:false, reason:'not-pending'}` 映射 409。审批应答同形（`{sessionId, approvalId, outcome:'allowed-once'|'rejected'}`），端点已实现；因本机 `danger-full-access` 权限预设未触发真审批帧，待权限收紧后复验。
4. SSE 帧目录：`session/event`（原始事件透传）/ `question` / `question-resolved` / `approval` / `approval-resolved` / `status` / `agent-error` / `stream-error` / `done`。
5. 阻塞模式默认超时 300s（`timeoutMs` 可调，上限 600s）。

**遗留到 Phase 2**：Docker 镜像、压测（30/100 并发、长跑内存）、真审批帧复验、`api.deepseek.com` 直连 provider。

### 12.3 Phase 2 结论（2026-08-27，Docker 镜像已构建并全链路验证 ✅）

验证环境：macOS arm64 + Colima（Virtualization.Framework）+ Docker 29。

**并发压测**（本机 9610 开发服务，create+message 完整链路）：

| 并发 | 成功率 | 延迟 |
|---|---|---|
| 10 | 10/10 | 1.7~2.5s（avg 2.0s） |
| 30 | 30/30 | p50 2.3s / max 4.2s |

延迟由 LLM 网关主导，载体层开销可忽略；单进程 30 并发无异常。100 并发与长跑内存待后续压测。

**容器镜像验证（✅ 全部通过）**：
- 镜像构建成功（dsh 0.1.1-rc.2 安装、插件镜像内编译、profile 组装、非 root）；
- 容器启动 + healthcheck `healthy`；nginx 反代 + 非 `/v1/` 路径 404 围栏 + 鉴权（先以 TLS 验证通过，后按"上游统一接入层终结 TLS"改为纯 HTTP 并复验）；
- 端到端：`5+5→10`（2.3s）、多轮 `×3→30`、bash 工具探针；
- **容器内沙箱生效**：无 bwrap 时回落 Landlock（Colima VM 内核支持，旧 ABI 报 partial enforcement）——Linux 部署沙箱可用这一关键假设得到证实。

**镜像构建踩坑全记录**（已修进 Dockerfile 注释）：
1. `COPY` 解引用 npm bin 符号链接 → ESM 从 `/usr/local/bin` 解析失败（`ERR_MODULE_NOT_FOUND`）→ 镜像内 `ln -sf` 重建；
2. `$DSH_HOME` 经 `COPY` 后属主 root → 启动写 `profiles/node_modules` 报 `EACCES` → `--chown=daf:daf`；
3. sessions 命名卷从镜像继承属主，路径不存在则变 root → **轮次静默空转（7ms 返回空文本）** → 镜像内预建 daf 属主目录；
4. DSH CLI 拒绝 `--host 0.0.0.0`（防 RCE 暴露）→ nginx 共享网络命名空间方案（§7）。

**容器访问宿主模型网关（重要纠正）**：本地验证曾以为需要 socat 端口转发，**实测不需要**——Colima(vz) 自带 VM→宿主 loopback 转发，容器内直接用网桥 IP（`host.lima.internal`，通常 `192.168.5.2`）即可访问宿主 127.0.0.1 上的网关。维护脚本：`scripts/sync-host-ip.sh`（VM 重建后 IP 漂移时同步 `config/settings.yaml` 的 baseURL）。生产无此问题（直连 `api.deepseek.com`）。

**真审批闭环（首次全链路验证 ✅）**：`workspace-write` 预设下，沙箱外写操作被拦截 → 模型提权重试 → SSE `approval` 帧（`rpcId`/`approvalId`/`toolName`/`reason`）→ `POST /v1/sessions/:id/approvals {outcome:'allowed-once'}` → `approval-resolved` → 提权生效、轮次完成。

**沙箱平台事实**：macOS = Seatbelt（`workspace-write` 放行 工作区+`/tmp`+用户 temp）；Linux = `bwrap` 优先、否则 Landlock（容器内已实测）；沙箱不可用时 fail-closed（`SANDBOX_UNAVAILABLE`），不会裸奔。

**部署文件已落盘并验证**：`Dockerfile`、`.dockerignore`、`docker-compose.yml`、`nginx/default.conf`（纯 HTTP + SSE + 限流 + 仅放行 `/v1/`）、`config/settings.example.yaml`（生产：deepseek-official + workspace-write）、`config/settings.yaml`（本地验证：宿主网关）、`.env.example`、`dsh-home/profiles/server/`、`deploy/docker-compose.offline.yml`、`scripts/sync-host-ip.sh`、`scripts/pack-image.sh`（离线部署包）。

**遗留待验**（不阻塞方案结论）：100 并发与长跑内存压测、`api.deepseek.com` 直连（需真实 `DEEPSEEK_API_KEY`）、生产 x86_64 环境以 `--platform linux/amd64` 复验构建。

---

## 13. 注意事项

1. **版本锁定**：`@deepseek-ai/dsh@0.1.1-rc.2`，禁止 `latest`；升级走回归流程。
2. **System Prompt**：金融合规边界与免责声明通过 profile 的 system prompt 段配置（`dsh-system-prompt` 接缝）。
3. **密钥轮换**：更新 `.env` 的 `DEEPSEEK_API_KEY` + `docker compose up -d` 重建容器（凭据为每请求解析，无需内核热加载）。
4. **监控**：`/v1/health` 接探针；审计 JSONL 接 ELK/Loki；关注单进程内存（4G 限额）。
5. **不要**在文档/配置中假设 DSH 存在 v1.0 方案列举的任何命令、端点或配置项——均以本文档 §5 核实过的配置面为准。

---

*本文档由 DAF 基础设施团队维护，变更需经安全评审。*
