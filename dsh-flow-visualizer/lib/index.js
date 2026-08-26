// src/collector.ts
var KNOWN_TOOL_TO_PLUGIN = {
  "ask_user_question": "@deepseek-ai/dsh-tool-ask-user",
  "bash": "@deepseek-ai/dsh-tool-bash",
  "cordis_define": "@deepseek-ai/dsh-tool-cordis",
  "cordis_inspect_list": "@deepseek-ai/dsh-tool-cordis",
  "cordis_inspect_query": "@deepseek-ai/dsh-tool-cordis",
  "cordis_inspect_self": "@deepseek-ai/dsh-tool-cordis",
  "cordis_run": "@deepseek-ai/dsh-tool-cordis",
  "cordis_stop": "@deepseek-ai/dsh-tool-cordis",
  "cordis_undefine": "@deepseek-ai/dsh-tool-cordis",
  "create_goal": "@deepseek-ai/dsh-tool-goal",
  "edit": "@deepseek-ai/dsh-tool-fs",
  "get_goal": "@deepseek-ai/dsh-tool-goal",
  "interrupt_agent": "@deepseek-ai/dsh-tool-subagent-control",
  "job_kill": "@deepseek-ai/dsh-tool-jobs",
  "job_list": "@deepseek-ai/dsh-tool-jobs",
  "job_output": "@deepseek-ai/dsh-tool-jobs",
  "list_agents": "@deepseek-ai/dsh-tool-subagent-control",
  "lsp": "@deepseek-ai/dsh-tool-lsp",
  "pwsh": "@deepseek-ai/dsh-tool-pwsh",
  "ralph": "@deepseek-ai/dsh-tool-ralph",
  "read": "@deepseek-ai/dsh-tool-fs",
  "read_image": "@deepseek-ai/dsh-tool-fs",
  "report": "@deepseek-ai/dsh-tool-subagent-report",
  "schedule_create": "@deepseek-ai/dsh-schedule",
  "schedule_delete": "@deepseek-ai/dsh-schedule",
  "schedule_list": "@deepseek-ai/dsh-schedule",
  "send_message": "@deepseek-ai/dsh-tool-subagent-control",
  "session_event_read": "@deepseek-ai/dsh-tool-session-query",
  "session_event_search": "@deepseek-ai/dsh-tool-session-query",
  "session_event_trace": "@deepseek-ai/dsh-tool-session-query",
  "session_search": "@deepseek-ai/dsh-tool-session-query",
  "session_trace": "@deepseek-ai/dsh-tool-session-query",
  "spawn_teammate": "@deepseek-ai/dsh-experimental-tool-agent-team",
  "str_replace_editor": "@deepseek-ai/dsh-tool-str-replace-editor",
  "team_task_create": "@deepseek-ai/dsh-experimental-tool-agent-team",
  "team_task_get": "@deepseek-ai/dsh-experimental-tool-agent-team",
  "team_task_list": "@deepseek-ai/dsh-experimental-tool-agent-team",
  "team_task_update": "@deepseek-ai/dsh-experimental-tool-agent-team",
  "terminal_close": "@deepseek-ai/dsh-tool-terminal",
  "terminal_list": "@deepseek-ai/dsh-tool-terminal",
  "terminal_open": "@deepseek-ai/dsh-tool-terminal",
  "terminal_read": "@deepseek-ai/dsh-tool-terminal",
  "terminal_send": "@deepseek-ai/dsh-tool-terminal",
  "terminal_signal": "@deepseek-ai/dsh-tool-terminal",
  "todo_write": "@deepseek-ai/dsh-tool-todo",
  "update_goal": "@deepseek-ai/dsh-tool-goal",
  "wait_agent": "@deepseek-ai/dsh-experimental-tool-agent-team",
  "web_fetch": "@deepseek-ai/dsh-tool-web",
  "web_search": "@deepseek-ai/dsh-tool-web",
  "write": "@deepseek-ai/dsh-tool-fs"
};
function resolveConfig(config = {}) {
  return {
    enabled: config.enabled ?? true,
    port: config.port ?? 9527,
    transport: "sse",
    maxBufferSize: config.maxBufferSize ?? 2e3,
    snapshotLimit: config.snapshotLimit ?? 1024,
    sensitiveFields: config.sensitiveFields ?? ["api_key", "token", "password", "authorization"],
    // 内置表兜底，用户配置覆盖
    toolToPlugin: { ...KNOWN_TOOL_TO_PLUGIN, ...config.toolToPlugin },
    autoOpen: config.autoOpen ?? false
  };
}
var Collector = class {
  traces = /* @__PURE__ */ new Map();
  traceByStep = /* @__PURE__ */ new Map();
  sequence = 0;
  opts;
  sanitize;
  unmappedTools = /* @__PURE__ */ new Set();
  constructor(opts, sanitize2) {
    this.opts = opts;
    this.sanitize = sanitize2 ?? ((value) => value);
  }
  traceIds() {
    return [...this.traces.keys()];
  }
  getTrace(traceId) {
    return this.traces.get(traceId);
  }
  startTrace(sessionId, turn, step) {
    const traceId = `${sessionId}:${turn}:${step}`;
    if (!this.traces.has(traceId)) {
      this.traces.set(traceId, {
        traceId,
        sessionId,
        startTime: Date.now(),
        endTime: null,
        events: [],
        totalDuration: null,
        totalTokens: null,
        toolCallCount: 0,
        status: "running"
      });
    }
    this.traceByStep.set(`${sessionId}:${turn}:${step}`, traceId);
    return traceId;
  }
  endTrace(sessionId, turn, step, status) {
    const traceId = this.traceByStep.get(`${sessionId}:${turn}:${step}`);
    if (!traceId) return;
    const trace = this.traces.get(traceId);
    if (!trace) return;
    trace.endTime = Date.now();
    trace.totalDuration = trace.endTime - trace.startTime;
    trace.status = status;
  }
  removeSession(sessionId) {
    for (const [key, traceId] of this.traceByStep) {
      if (key.startsWith(`${sessionId}:`)) {
        this.traceByStep.delete(key);
        const trace = this.traces.get(traceId);
        if (!trace || trace.status !== "running") this.traces.delete(traceId);
      }
    }
  }
  record(phase, payload, traceId, pluginName) {
    const event = this.createEvent(phase, payload);
    event.status = "success";
    if (traceId) event.traceId = traceId;
    if (pluginName) event.pluginName = pluginName;
    this.push(event);
    return event;
  }
  /** 工具名 → 插件名。命中映射表返回插件名，未命中记录到 unmappedTools 并返回工具名本身。 */
  resolveToolPlugin(name2) {
    if (!name2) return "";
    const mapped = this.opts.toolToPlugin[name2];
    if (mapped) return mapped;
    this.unmappedTools.add(name2);
    return name2;
  }
  /** 返回所有未命中映射表的工具名，供补全配置用。 */
  unmappedToolList() {
    return [...this.unmappedTools];
  }
  createEvent(phase, payload) {
    const input = this.snapshot(payload);
    return {
      id: `evt-${++this.sequence}`,
      sessionId: "",
      traceId: "unknown",
      parentId: null,
      timestamp: Date.now(),
      phase,
      pluginName: "",
      duration: null,
      input,
      output: null,
      metadata: {},
      status: "running"
    };
  }
  push(event) {
    const trace = this.traces.get(event.traceId);
    if (!trace) return;
    trace.events.push(event);
    if (trace.events.length > this.opts.maxBufferSize) trace.events.shift();
  }
  snapshot(value) {
    if (value === void 0) return null;
    const cleaned = this.sanitize(value);
    try {
      const str = JSON.stringify(cleaned);
      if (str === void 0) return null;
      if (str.length > this.opts.snapshotLimit) {
        return str.slice(0, this.opts.snapshotLimit) + "...[truncated]";
      }
      return JSON.parse(str);
    } catch {
      return String(cleaned);
    }
  }
};

// src/emitter.ts
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
var __dirname = path.dirname(fileURLToPath(import.meta.url));
var VIEWER_DIST = path.resolve(__dirname, "..", "viewer", "dist");
var CONTENT_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".png": "image/png",
  ".ico": "image/x-icon"
};
function openBrowser(url) {
  const cmd = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
  try {
    const child = spawn(cmd, [url], { stdio: "ignore", detached: true });
    child.on("error", () => {
    });
    child.unref();
  } catch {
  }
}
function serveStatic(req, res) {
  const rawPath = (req.url ?? "/").split("?")[0].split("#")[0];
  const urlPath = rawPath === "/" || rawPath === "" ? "/index.html" : rawPath;
  const filePath = path.join(VIEWER_DIST, path.normalize(urlPath));
  if (!filePath.startsWith(VIEWER_DIST)) return false;
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false;
  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, { "Content-Type": CONTENT_TYPES[ext] ?? "application/octet-stream" });
  res.end(fs.readFileSync(filePath));
  return true;
}
var Emitter = class {
  clients = /* @__PURE__ */ new Set();
  server;
  opts;
  collector;
  pluginProvider = () => [];
  constructor(opts, collector) {
    this.opts = opts;
    this.collector = collector;
  }
  setPluginProvider(provider) {
    this.pluginProvider = provider;
  }
  start() {
    this.server = http.createServer((req, res) => {
      if (req.url === "/events" && req.method === "GET") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "Access-Control-Allow-Origin": "*"
        });
        this.clients.add(res);
        req.on("close", () => this.clients.delete(res));
        const ids = this.collector.traceIds();
        this.send("trace.list", { traceIds: ids });
        for (const id of ids) {
          const trace = this.collector.getTrace(id);
          if (trace) this.send("trace.init", trace);
        }
        return;
      }
      const JSON_HEADERS = {
        "Content-Type": "application/json",
        "Access-Control-Allow-Origin": "*"
      };
      if (req.url?.startsWith("/trace/") && req.method === "GET") {
        const traceId = decodeURIComponent(req.url.split("/trace/")[1]);
        const trace = this.collector.getTrace(traceId);
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify(trace ?? null));
        return;
      }
      if (req.url === "/unmapped-tools" && req.method === "GET") {
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify({ tools: this.collector.unmappedToolList() }));
        return;
      }
      if (req.url === "/plugins" && req.method === "GET") {
        res.writeHead(200, JSON_HEADERS);
        res.end(JSON.stringify({ plugins: this.pluginProvider() }));
        return;
      }
      if (req.method === "GET" && serveStatic(req, res)) return;
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "not found" }));
    });
    this.tryListen(this.opts.port, 5);
  }
  /** 端口冲突时顺延重试（最多 5 次），避免 EADDRINUSE 直接崩 */
  tryListen(port, attemptsLeft) {
    const server = this.server;
    if (!server) return;
    const onError = (err) => {
      server.removeListener("error", onError);
      if (err.code === "EADDRINUSE" && attemptsLeft > 0) {
        console.log(`[flow-tracer] port ${port} in use, trying ${port + 1}`);
        this.tryListen(port + 1, attemptsLeft - 1);
      } else {
        console.error(`[flow-tracer] viewer server failed: ${err.message}`);
      }
    };
    server.once("error", onError);
    server.listen(port, "127.0.0.1", () => {
      server.removeListener("error", onError);
      const url = `http://127.0.0.1:${port}`;
      console.log(`[flow-tracer] Viewer at ${url}`);
      if (this.opts.autoOpen) openBrowser(url);
    });
  }
  send(type, payload) {
    const data = `event: ${type}
data: ${JSON.stringify(payload)}

`;
    for (const client of this.clients) {
      client.write(data);
    }
  }
  emitEvent(event) {
    this.send("event", event);
  }
  emitTraceEnd(traceId, status, duration) {
    this.send("trace.end", { traceId, status, duration });
  }
  async close() {
    for (const client of this.clients) client.end();
    this.clients.clear();
    if (!this.server) return;
    await new Promise((resolve, reject) => {
      this.server.close((error) => error ? reject(error) : resolve());
    });
    this.server = void 0;
  }
};

// src/hooks.ts
var PHASE_BY_WATERFALL = {
  "agent/pre-step": "agent.pre-step",
  "agent/request": "agent.request",
  "tools/pre-execute": "tools.pre-execute",
  "tools/execute": "tools.execute",
  "tools/post-execute": "tools.post-execute"
};
function registerHooks(ctx, collector, emitter) {
  let currentSessionId = "";
  let currentTraceId = "";
  let currentProvider = "";
  for (const [event, phase] of Object.entries(PHASE_BY_WATERFALL)) {
    ctx.on(event, async function(...args) {
      const next = args[args.length - 1];
      const firstArg = args[0];
      const input = pickWaterfallInput(phase, firstArg);
      if (phase === "agent.pre-step" && currentSessionId && firstArg) {
        const turn = firstArg.turn;
        const step = firstArg.step;
        if (turn !== void 0 && step !== void 0) {
          currentTraceId = collector.startTrace(currentSessionId, turn, step);
        }
      }
      const pluginName = resolveWaterfallPlugin(collector, phase, firstArg);
      const traceId = currentTraceId || void 0;
      const flowEvent = collector.record(phase, input, traceId, pluginName);
      const start = Date.now();
      try {
        const result = typeof next === "function" ? await next() : void 0;
        if (flowEvent) {
          flowEvent.duration = Date.now() - start;
          flowEvent.output = collector.snapshot(result);
          flowEvent.status = "success";
        }
        if (flowEvent) emitter.emitEvent(flowEvent);
        return result;
      } catch (error) {
        if (flowEvent) {
          flowEvent.duration = Date.now() - start;
          flowEvent.status = "error";
          flowEvent.metadata.error = error instanceof Error ? error.message : String(error);
        }
        if (flowEvent) emitter.emitEvent(flowEvent);
        throw error;
      }
    });
  }
  ctx.on("llm/stream", function(options, next) {
    if (options?.purpose) return next();
    if (currentTraceId) {
      currentProvider = options?.provider ?? currentProvider;
      const provider = options?.provider ?? "";
      const model = options?.model ?? "";
      const flowEvent = collector.record("llm.stream", {
        provider,
        model,
        messages: options?.messages,
        system: options?.system,
        tools: options?.tools
      }, currentTraceId, model ? `${provider}/${model}` : provider);
      if (flowEvent) emitter.emitEvent(flowEvent);
    }
    return next();
  });
  ctx.on("session/created", (session) => {
    currentSessionId = session?.id ?? "";
    collector.record("session.created", { id: session?.id });
  });
  ctx.on("session/event", (session, event) => {
    const sessionId = session?.id;
    const type = event?.type;
    if (sessionId) currentSessionId = sessionId;
    if (type === "assistant/chunk") return;
    const data = event?.data;
    const traceId = resolveTraceId(collector, sessionId, data);
    if (!traceId) return;
    currentTraceId = traceId;
    if (type === "step/start" && data?.turn !== void 0 && data?.step !== void 0 && sessionId) {
      collector.startTrace(sessionId, data.turn, data.step);
    }
    const pluginName = resolveSessionPlugin(collector, type, data);
    const flowEvent = collector.record(
      "session.event",
      { type, seq: event?.seq, time: event?.time, data: pickSessionData(type, data) },
      traceId,
      pluginName
    );
    if (type === "step/end" && data?.turn !== void 0 && data?.step !== void 0 && sessionId) {
      collector.endTrace(sessionId, data.turn, data.step, "completed");
      emitter.emitTraceEnd(traceId, "completed", null);
    }
    if (flowEvent) emitter.emitEvent(flowEvent);
  });
  ctx.on("tools/result", (exec, result) => {
    collector.record("tools.result", {
      callId: exec?.callId,
      rootCallId: exec?.rootCallId,
      name: exec?.name,
      arguments: exec?.arguments,
      result
    }, currentTraceId || void 0, collector.resolveToolPlugin(exec?.name));
  });
  ctx.on("agent/request-error", function(payload, next) {
    collector.record("agent.request-error", pickAgentPayload(payload), currentTraceId || void 0, currentProvider);
    return typeof next === "function" ? next() : void 0;
  });
  ctx.on("agent/error", (payload) => {
    collector.record("agent.error", pickAgentPayload(payload), currentTraceId || void 0, currentProvider);
  });
  ctx.on("session/disposed", (session) => {
    collector.record("session.disposed", { id: session?.id });
    collector.removeSession(session?.id);
    currentSessionId = "";
    currentTraceId = "";
    currentProvider = "";
  });
}
function resolveWaterfallPlugin(collector, phase, arg) {
  if (!arg) return "";
  switch (phase) {
    case "tools.pre-execute":
    case "tools.execute":
    case "tools.post-execute":
      return collector.resolveToolPlugin(arg.name);
    case "agent.request":
    case "agent.pre-step":
      return "";
    default:
      return "";
  }
}
function resolveSessionPlugin(collector, type, data) {
  if (!type || !data) return "";
  switch (type) {
    case "tool/call":
      return collector.resolveToolPlugin(data.name);
    case "tool/result": {
      const msg = data.message;
      if (msg?.content) {
        for (const block of msg.content) {
          if (block?.type === "tool-result" && block?.toolCallId) {
          }
        }
      }
      return "";
    }
    case "assistant/message": {
      const src = data.message?.source;
      if (!src) return "";
      if (src.provider && src.model) return `${src.provider}/${src.model}`;
      if (src.plugin) return src.plugin;
      return src.provider ?? "";
    }
    case "user/message": {
      const src = data.source;
      if (!src) return "";
      if (src.plugin) return src.plugin;
      if (src.kind === "user") return "user";
      return "";
    }
    case "request/header":
      return data.header?.config?.provider ?? "";
    case "session/title-llm-request":
      return data.route?.provider ?? "";
    default:
      return "";
  }
}
function pickWaterfallInput(phase, arg) {
  if (!arg) return void 0;
  switch (phase) {
    case "agent.pre-step":
      return { messages: arg.messages, turn: arg.turn, step: arg.step };
    case "agent.request":
      return { turn: arg.turn, step: arg.step };
    case "tools.pre-execute":
    case "tools.execute":
    case "tools.post-execute":
      return {
        callId: arg.callId,
        rootCallId: arg.rootCallId,
        name: arg.name,
        arguments: arg.arguments
      };
    default:
      return arg;
  }
}
function pickAgentPayload(payload) {
  if (!payload) return void 0;
  return {
    turn: payload.turn,
    step: payload.step,
    provider: payload.provider,
    error: payload.error instanceof Error ? payload.error.message : String(payload.error ?? "")
  };
}
function pickSessionData(type, data) {
  if (!data) return void 0;
  switch (type) {
    case "turn/start":
    case "turn/end":
      return { turn: data.turn };
    case "step/start":
    case "step/end":
      return { turn: data.turn, step: data.step };
    case "assistant/message":
      return {
        turn: data.turn,
        step: data.step,
        message: pickMessage(data.message),
        usage: data.usage
      };
    case "tool/call":
      return { turn: data.turn, step: data.step, callId: data.callId, name: data.name, arguments: data.arguments };
    case "tool/result":
      return { turn: data.turn, step: data.step, message: pickMessage(data.message) };
    case "user/message":
      return { content: data.content, source: data.source };
    default:
      return data;
  }
}
function pickMessage(message) {
  if (!message) return void 0;
  return {
    role: message.role,
    content: message.content,
    source: message.source ? { kind: message.source.kind, provider: message.source.provider, model: message.source.model, plugin: message.source.plugin } : void 0
  };
}
function resolveTraceId(collector, sessionId, data) {
  if (sessionId && data?.turn !== void 0 && data?.step !== void 0) {
    return `${sessionId}:${data.turn}:${data.step}`;
  }
  if (sessionId) {
    const ids = collector.traceIds().filter((id) => id.startsWith(`${sessionId}:`));
    if (ids.length > 0) return ids[ids.length - 1];
  }
  return void 0;
}

// src/sanitizer.ts
var MASK = "***";
var MAX_DEPTH = 10;
function sanitize(value, fields, depth = 0) {
  if (depth > MAX_DEPTH || value === null || value === void 0) return null;
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    const out = [];
    for (let i = 0; i < value.length && i < 100; i++) {
      out.push(sanitize(value[i], fields, depth + 1));
    }
    return out;
  }
  if (typeof value === "object") {
    const out = {};
    let count = 0;
    for (const [key, val] of Object.entries(value)) {
      if (count++ > 50) break;
      const lower = key.toLowerCase();
      const hit = fields.some((f) => lower === f.toLowerCase() || lower.includes(f.toLowerCase()));
      out[key] = hit ? MASK : sanitize(val, fields, depth + 1);
    }
    return out;
  }
  return String(value);
}
function createSanitizer(opts) {
  const fields = opts.sensitiveFields;
  return (value) => sanitize(value, fields);
}

// src/plugins.ts
function listPlugins(ctx) {
  const loader = ctx.get("loader");
  if (!loader || typeof loader.entries !== "function") return [];
  const result = [];
  const phaseMap = {
    0: "pending",
    1: "loading",
    2: "active",
    3: "failed",
    4: "disposed",
    5: "unloading"
  };
  for (const entry of loader.entries()) {
    const id = entry?.options?.id ?? "";
    const name2 = entry?.options?.name ?? "";
    const fiber = entry?.fiber;
    const inject2 = [];
    if (fiber?.inject && typeof fiber.inject === "object") {
      for (const k of Object.keys(fiber.inject)) inject2.push(k);
    }
    const provides = [];
    if (fiber?.store && typeof fiber.store === "object") {
      for (const k of Object.keys(fiber.store)) provides.push(k);
    }
    const group = !!entry?.options?.group;
    const isolateRaw = entry?.options?.isolate;
    const isolate = typeof isolateRaw === "string" ? isolateRaw : isolateRaw === true ? "<local>" : null;
    result.push({
      id,
      name: name2,
      enabled: !entry?.disabled,
      phase: phaseMap[fiber?.state] ?? "unknown",
      inject: inject2,
      provides,
      group,
      isolate
    });
  }
  return result;
}

// src/toolmap.ts
import fs2 from "node:fs";
import path2 from "node:path";
function findDshRoot() {
  let entry = process.argv[1];
  if (!entry) return null;
  try {
    entry = fs2.realpathSync(entry);
  } catch {
  }
  let d = path2.dirname(path2.resolve(entry));
  for (let i = 0; i < 4; i++) {
    const pj = path2.join(d, "package.json");
    if (fs2.existsSync(pj)) {
      try {
        if (JSON.parse(fs2.readFileSync(pj, "utf-8")).name === "@deepseek-ai/dsh") return d;
      } catch {
      }
    }
    d = path2.dirname(d);
  }
  return null;
}
var REGISTER_PAT = /register\(\s*defineTool\(\{\s*name:\s*["']([^"']+)["']/g;
function scanInstalledTools(dshRoot) {
  const out = {};
  if (!dshRoot) return out;
  const nm = path2.join(dshRoot, "node_modules", "@deepseek-ai");
  let dirs = [];
  try {
    dirs = fs2.readdirSync(nm);
  } catch {
    return out;
  }
  for (const dir of dirs) {
    const lib = path2.join(nm, dir, "lib");
    try {
      if (!fs2.statSync(lib).isDirectory()) continue;
    } catch {
      continue;
    }
    let files = [];
    try {
      files = fs2.readdirSync(lib).filter((f) => f.endsWith(".js"));
    } catch {
      continue;
    }
    for (const f of files) {
      let text = "";
      try {
        text = fs2.readFileSync(path2.join(lib, f), "utf-8");
      } catch {
        continue;
      }
      if (!text.includes("defineTool")) continue;
      const pkg = `@deepseek-ai/${dir}`;
      for (const m of text.matchAll(REGISTER_PAT)) {
        const prev = out[m[1]];
        if (!prev || prev.endsWith("-persistent") && !pkg.endsWith("-persistent")) out[m[1]] = pkg;
      }
    }
  }
  return out;
}

// src/commands.ts
function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n, w) => String(n).padStart(w, "0");
  return `${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}.${p(d.getMilliseconds(), 3)}`;
}
function fmtDuration(ms) {
  if (ms == null) return "  -  ";
  return ms < 1e3 ? `${Math.round(ms)}ms` : `${(ms / 1e3).toFixed(2)}s`;
}
function pad(s, n) {
  return s.length > n ? s.slice(0, n - 1) + "\u2026" : s.padEnd(n);
}
function formatTimeline(traces) {
  const lines = [];
  for (const t of traces) {
    const [, turn, step] = t.traceId.split(":");
    lines.push(
      `\u25B8 Turn ${turn} \xB7 Step ${step} \u2014 ${fmtDuration(t.totalDuration)} \xB7 ${t.status} \xB7 ${t.events.length} events`
    );
    for (const ev of t.events) {
      lines.push(
        `  ${fmtTime(ev.timestamp)}  ${pad(ev.phase, 20)} ${pad(ev.pluginName || "-", 32)} ${pad(fmtDuration(ev.duration), 8)} ${ev.status}`
      );
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd();
}
function registerFlowCommand(ctx, collector) {
  const registry = ctx.commands;
  if (!registry || typeof registry.register !== "function") return;
  registry.register({
    name: "flow",
    description: "show this session\u2019s plugin/event flow (append --json for raw traces)",
    input: { hint: "[--json]" },
    recordInput: false,
    handler: (invocation) => {
      const sessionId = invocation?.agent?.session?.id;
      if (!sessionId) return { kind: "error", text: "flow: no active session" };
      const traces = collector.traceIds().filter((id) => id.startsWith(`${sessionId}:`)).map((id) => collector.getTrace(id)).filter((t) => !!t);
      if (traces.length === 0) {
        return { kind: "success", text: "flow: no data for this session yet \u2014 send a message first." };
      }
      if (/--json/.test(invocation?.rawInput ?? "")) {
        return { kind: "success", text: JSON.stringify(traces, null, 2) };
      }
      return { kind: "success", text: formatTimeline(traces) };
    }
  });
}

// src/index.ts
var name = "dsh-plugin-flow-tracer";
var inject = ["loader"];
function apply(ctx, config = {}) {
  const opts = resolveConfig(config);
  if (!opts.enabled) return;
  setImmediate(() => {
    const root = findDshRoot();
    if (!root) return;
    const scanned = scanInstalledTools(root);
    const userKeys = new Set(Object.keys(config.toolToPlugin ?? {}));
    for (const [tool, pkg] of Object.entries(scanned)) {
      if (!userKeys.has(tool)) opts.toolToPlugin[tool] = pkg;
    }
    console.log(`[flow-tracer] scanned ${Object.keys(scanned).length} tool\u2192plugin mappings from installed packages`);
  });
  const sanitize2 = createSanitizer(opts);
  const collector = new Collector(opts, sanitize2);
  const emitter = new Emitter(opts, collector);
  emitter.setPluginProvider(() => listPlugins(ctx));
  registerHooks(ctx, collector, emitter);
  emitter.start();
  const anyCtx = ctx;
  if (typeof anyCtx.inject === "function") {
    anyCtx.inject(["commands"], (c) => registerFlowCommand(c, collector));
  } else if (anyCtx.commands) {
    registerFlowCommand(anyCtx, collector);
  }
  ctx.effect(
    () => async () => {
      await emitter.close();
    },
    "dsh-plugin-flow-tracer"
  );
}
var index_default = apply;
export {
  Collector,
  Emitter,
  apply,
  index_default as default,
  inject,
  name
};
