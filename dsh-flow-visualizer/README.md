# dsh-plugin-flow-tracer

DSH 会话数据流可视化插件：实时采集 Cordis 事件总线上的 Agent / 模型 / 工具调度事件，在本地 Viewer 中以**时间线、总线时序图、插件依赖树**三个视角呈现单次会话的完整流转，不侵入 DSH 核心。

## 安装

```bash
# 安装到目标 profile（web / tui / headless），声明了 dsh.bundle，自动进 profile 层栈
dsh plugin --profile web add dsh-plugin-flow-tracer

# 重启 DSH
dsh web
```

启动日志出现 `[flow-tracer] Viewer at http://127.0.0.1:9527` 即就绪。

自定义配置：在 `~/.dsh/profiles/web/cordis.patch.yml` 按 id 覆盖（last write wins）：

```yaml
- insert:
    - id: flow-tracer
      config:
        autoOpen: true
        port: 9527
```

## 使用

- **web 内嵌**：会话页「调度」tab（与「轨迹」平级），iframe 嵌入 Viewer，按当前会话深链，embed 模式无独立 header
- **Viewer**：浏览器打开 `http://127.0.0.1:9527`（配置 `autoOpen: true` 可启动时自动打开）
  - 左栏：用户输入（含插件注入的上下文）+ 事件明细（可展开输入/输出快照）
  - 右栏 Tab 一 **Cordis 总线**：四层时序（注册者→触发者→事件→监听者）+ 真实时间轴耗时瀑布，hover 联动、点击检查输入输出
  - 右栏 Tab 二 **Cordis 插件树**：168+ 插件依赖 DAG（ELK 布局），绿圈数字 = 本次对话参与顺序，与「调度序列」弹窗编号一致
  - Header：会话选择、事件/工具/耗时汇总、调度序列、插件清单
- **终端**：对话中输入 `/flow` 输出当前会话时间线，`/flow --json` 输出原始 trace（TUI/headless 适用）

## 配置

insert 条目下加 `config`：

```yaml
- insert:
    - id: flow-tracer
      name: 'dsh-plugin-flow-tracer'
      config:
        port: 9527            # Viewer 端口，冲突时自动顺延
        autoOpen: false       # 启动时自动打开浏览器
        enabled: true         # 总开关
        maxBufferSize: 2000   # 每 trace 事件上限（环形缓冲）
        snapshotLimit: 1024   # 输入/输出快照截断字符数
        sensitiveFields: [api_key, token, password, authorization]  # 脱敏字段
        toolToPlugin:         # 工具名 → 插件包名，覆盖/补充内置表
          my_tool: '@myorg/dsh-tool-mine'
```

工具归属默认零配置：内置映射表（50 工具）+ 启动时自动扫描已安装插件包（对齐实际 DSH 版本）。`/unmapped-tools` 端点列出未命中工具，便于补配置。

## 本地开发

```bash
# 以 patch 方式加载本仓库源码（无需安装）
dsh web --patch ./plugin.patch.yml

# 前端开发
cd viewer && pnpm install && pnpm build   # 产物由插件托管于 9527

npm run typecheck   # 后端类型检查
```

## 已知问题

- **Hub 桌面客户端**：「调度」tab 在部分桌面版本（WKWebView 壳）中不渲染（组件挂载即失败，清缓存/重启无效）；同版本 Chrome 访问正常。已报障 Hub 维护者。桌面用户请暂用浏览器访问 `http://127.0.0.1:<port>`（端口见启动日志）。

## 故障排查

**安装后 DSH 启动报 `credentials-local: the value for "version"/"refs" ... must be a string`**

这是 DSH 环境问题，非本插件缺陷：旧版 DSH（rc.7）的凭证解析器只认扁平格式，而你的 `~/.dsh/.credentials.yaml` 是新版工具写的嵌套格式，安装流程的 relink 暴露了该不一致。修复（二选一）：

```bash
# 方法一：把凭证文件拍平（新旧解析器都认）；先备份
cp ~/.dsh/.credentials.yaml ~/.dsh/.credentials.yaml.bak
sed -i '' -e '/^version:/d' -e '/^refs:/d' -e 's/^ *//' ~/.dsh/.credentials.yaml

# 方法二：升级 DSH 到带凭证迁移逻辑的版本
```

## 边界与路线

- 事件注册者（owner）与工具归属来自静态表/安装产物扫描：Cordis 运行时无注册者元数据（见 `docs/技术方案.md` D.7 spike 结论）
- v1.1：DSH web「调度」tab 集成（`conversation.view` slot）、上游 PR `ToolDefinition.source`、会话回放、OTel 导出
