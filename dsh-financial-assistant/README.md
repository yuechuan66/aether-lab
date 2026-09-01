# DSH Financial Assistant — DSH 服务端部署

基于 DeepSeek Harness（DSH）`0.1.1-rc.2` 的纯服务端 AI 助手：通过**自研载体插件**把 DSH 内核包装成对外 REST/SSE 服务，供自研 Agent 客户端与业务系统接入。

技术方案与全部验证结论见 `docs/DSH Financial Assistant 服务端部署技术方案.md`（v2.0，§12.1–12.3）。

---

## 目录结构

### 1. 自研载体插件 —— 唯一的代码

```
plugins/dsh-server-api/
├── src/
│   ├── index.ts        插件入口：name/inject/apply，装配 hub + routes，读 DSH_API_KEYS
│   ├── hub.ts          MuxHub：全进程一条 mux/host 事件流，按 sessionId 分发给订阅者，断流自动重连
│   ├── routes.ts       /v1/* 路由层：鉴权、建会话、消息（阻塞/SSE）、history、cancel、反问应答、审批应答
│   └── types.ts        DSH 契约的结构化类型（照 0.1.1-rc.2 的 .d.ts 核实，DSH 升级时要复核）
├── package.json        版本 0.1.0；声明 dsh.bundle.patch；build/typecheck 脚本
├── tsconfig.json
├── cordis.patch.yml    bundle patch：把 dsh-server-api 条目 insert 进组合
├── lib/index.js        esbuild 产物——运行时真正被加载的是它
└── pnpm-lock.yaml
```

### 2. 镜像骨架 —— 打进 Docker 镜像的 $DSH_HOME

```
dsh-home/profiles/server/
├── package.json        bundles = dsh-base + dsh-web-app + dsh-server-api；
│                       插件用相对 file: 依赖（构建期拷入）
└── cordis.patch.yml    空数组（host/port 走 CLI 参数）
```

### 3. 部署编排

```
Dockerfile              两阶段构建；4 个踩坑修复都注释在对应行
docker-compose.yml      dsh-server + nginx（network_mode: service 共享网络命名空间）
.dockerignore
.env                    ⚠️ 本地真实配置（含密钥），勿提交
.env.example            生产模板（DEEPSEEK_API_KEY 版）
```

### 4. 运行时挂载配置

```
config/
├── settings.yaml           当前挂载的本地验证配置（指向宿主网关 192.168.5.2:15721）
└── settings.example.yaml   生产模板（deepseek-official 直连 + workspace-write 权限）

nginx/
└── default.conf        纯 HTTP + SSE 透传 + 限流 + 只放行 /v1/（其余 404）；
                        TLS 由上游统一接入层终结

deploy/
└── docker-compose.offline.yml   离线包专用 compose 模板（image: 引用，__VERSION__ 占位）
```

### 5. 工具与文档

```
scripts/
├── pack-image.sh       打离线部署包（镜像 + 编排 + 配置模板 + 部署手册 → zip）
└── sync-host-ip.sh     Colima VM 重建后网桥 IP 漂移时，同步 settings.yaml 的 baseURL

docs/
└── DSH Financial Assistant 服务端部署技术方案.md   方案 v2.0 + Phase 0→2 验证记录
```

### 6. 不在项目目录里的运行时产物

| 位置 | 是什么 |
|---|---|
| `~/.dsh/profiles/dshspike/` | Phase 0/1 本地开发 profile（9610 开发服务），`link:` 软链到插件源码，改代码即生效 |
| Docker 卷 `dsh-sessions` | 容器内会话持久化 + 审计素材 |

---

## 数据流（一句话）

`plugins/` 源码 → 镜像内 esbuild 编译 → `dsh-home/` profile 安装它 → 容器启动 `dsh --profile server` → 挂载 `config/settings.yaml` 决定模型与权限 → 外部流量只从 nginx:80 进（仅 `/v1/`，TLS 由上游接入层终结）。

## 快速开始（Docker）

```bash
cp config/settings.example.yaml config/settings.yaml   # 按需改模型配置
cp .env.example .env                                    # 填 DEEPSEEK_API_KEY 与 DSH_API_KEYS
docker compose up -d --build
curl -s http://127.0.0.1:8080/v1/health
```

> 重启 dsh-server 后必须一并重启 nginx（共享网络命名空间，见方案 §7 运维注意）。

## 离线打包分发

```bash
scripts/pack-image.sh 1.0.0                          # 默认 linux/amd64（生产服务器常见）
scripts/pack-image.sh 1.0.0 --platform linux/arm64
```

产物：`dist/dsh-financial-assistant-<版本>-<架构>-offline.zip`，内含：

```
images.tar.gz          dsh-server + nginx 两个镜像（docker save）
docker-compose.yml     离线版（image: 引用，无源码不构建）
.env.example           密钥模板
config/                settings.example.yaml
nginx/                 default.conf（纯 HTTP）
DEPLOY.md              接收方部署手册
技术方案.md
```

接收方全程无需镜像仓库访问：`docker load < images.tar.gz` → 填 `.env`/`settings.yaml` → `docker compose up -d`。

## 本地开发（不起 Docker）

```bash
cd plugins/dsh-server-api && pnpm install && pnpm build
DSH_API_KEYS=dev-key dsh --profile dshspike --no-open --port 9610
curl -s -X POST http://127.0.0.1:9610/v1/sessions -H "Authorization: Bearer dev-key" -d '{}'
```

## 对外 API 速览

| 方法 | 路径 | 说明 |
|---|---|---|
| GET | `/v1/health` | 健康检查（免鉴权） |
| POST | `/v1/sessions` | 创建/恢复会话（带 `sessionId` 恢复，cwd 冲突自动重试） |
| POST | `/v1/sessions/:id/messages` | 发消息；`stream:true` 走 SSE，否则阻塞返回文本 |
| GET | `/v1/sessions/:id/history` | 分页历史 |
| POST | `/v1/sessions/:id/cancel` | 中止当前轮 |
| POST | `/v1/sessions/:id/answers` | 应答反问（rpcId + answers） |
| POST | `/v1/sessions/:id/approvals` | 应答审批（rpcId + approvalId + outcome） |

鉴权：`Authorization: Bearer <key>`（key 来自 `DSH_API_KEYS`，未配置时受保护路由一律 503）。
