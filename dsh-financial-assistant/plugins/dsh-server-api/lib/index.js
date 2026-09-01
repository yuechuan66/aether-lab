// src/hub.ts
import { randomUUID } from "node:crypto";
var RECONNECT_DELAY_MS = 1e3;
var MuxHub = class {
  constructor(apiProxy, log) {
    this.apiProxy = apiProxy;
    this.log = log;
  }
  listeners = /* @__PURE__ */ new Map();
  /** sessionId -> (rpcId -> pending interaction frame); mux replays these on reopen. */
  pending = /* @__PURE__ */ new Map();
  ac = new AbortController();
  started = false;
  start() {
    if (this.started) return;
    this.started = true;
    void this.runMux();
    void this.runHost();
  }
  stop() {
    this.ac.abort();
  }
  subscribe(sessionId, listener) {
    let set = this.listeners.get(sessionId);
    if (!set) {
      set = /* @__PURE__ */ new Set();
      this.listeners.set(sessionId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (!set.size) this.listeners.delete(sessionId);
    };
  }
  /** Replay still-pending question/approval frames to a fresh subscriber. */
  replayPending(sessionId, listener) {
    const map = this.pending.get(sessionId);
    if (!map) return;
    for (const { frame } of map.values()) {
      try {
        listener(frame);
      } catch (e) {
        this.log("listener error", e);
      }
    }
  }
  dispatch(sessionId, frame) {
    if (!sessionId) return;
    const set = this.listeners.get(sessionId);
    if (!set) return;
    for (const l of set) {
      try {
        l(frame);
      } catch (e) {
        this.log("listener error", e);
      }
    }
  }
  broadcast(frame) {
    for (const set of this.listeners.values()) {
      for (const l of set) {
        try {
          l(frame);
        } catch (e) {
          this.log("listener error", e);
        }
      }
    }
  }
  trackPending(sessionId, rpcId, kind, frame) {
    if (!sessionId) return;
    let map = this.pending.get(sessionId);
    if (!map) {
      map = /* @__PURE__ */ new Map();
      this.pending.set(sessionId, map);
    }
    map.set(rpcId, { kind, frame });
  }
  untrackPending(sessionId, rpcId) {
    const map = sessionId ? this.pending.get(sessionId) : void 0;
    map?.delete(rpcId);
  }
  onMux(req) {
    const p = req.payload;
    if (!p || typeof p.type !== "string") return;
    switch (p.type) {
      case "session/event":
        if (p.event && typeof p.event.type === "string") {
          this.dispatch(p.sessionId, { kind: "event", event: p.event });
        }
        return;
      case "question/requested": {
        const frame = { kind: "question", rpcId: req.rpcId, questions: p.questions };
        this.trackPending(p.sessionId, req.rpcId, "question", frame);
        this.dispatch(p.sessionId, frame);
        return;
      }
      case "question/resolved":
        if (p.questionRpcId) this.untrackPending(p.sessionId, p.questionRpcId);
        this.dispatch(p.sessionId, { kind: "question-resolved", rpcId: p.questionRpcId ?? "", outcome: p.outcome });
        return;
      case "approval/requested": {
        const frame = {
          kind: "approval",
          rpcId: req.rpcId,
          approvalId: p.approvalId,
          toolName: p.toolName,
          reason: p.reason
        };
        this.trackPending(p.sessionId, req.rpcId, "approval", frame);
        this.dispatch(p.sessionId, frame);
        return;
      }
      case "approval/resolved": {
        const map = p.sessionId ? this.pending.get(p.sessionId) : void 0;
        if (map) {
          for (const [rpcId, entry] of [...map]) {
            if (entry.kind === "approval") map.delete(rpcId);
          }
        }
        this.dispatch(p.sessionId, { kind: "approval-resolved", approvalId: p.approvalId, outcome: p.outcome });
        return;
      }
      case "stream/error":
        this.broadcast({ kind: "stream-error", message: p.error?.message ?? "stream error" });
        return;
      default:
        return;
    }
  }
  onHost(req) {
    const p = req.payload;
    if (!p || typeof p.type !== "string") return;
    if (p.type === "host/session-status" && typeof p.running === "boolean") {
      this.dispatch(p.sessionId, { kind: "status", running: p.running });
    } else if (p.type === "host/agent-error") {
      this.dispatch(p.sessionId, { kind: "agent-error", message: p.message ?? "agent error" });
    }
  }
  async runMux() {
    while (!this.ac.signal.aborted) {
      try {
        const stream = this.apiProxy.events.mux({ rpcId: randomUUID(), payload: {} }, this.ac.signal);
        for await (const req of stream) this.onMux(req);
        this.log("mux stream ended; reopening");
      } catch (e) {
        if (this.ac.signal.aborted) return;
        this.log("mux stream error; reconnecting:", String(e?.message ?? e));
      }
      if (this.ac.signal.aborted) return;
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    }
  }
  async runHost() {
    while (!this.ac.signal.aborted) {
      try {
        const stream = this.apiProxy.events.host({ rpcId: randomUUID(), payload: {} }, this.ac.signal);
        for await (const req of stream) this.onHost(req);
        this.log("host stream ended; reopening");
      } catch (e) {
        if (this.ac.signal.aborted) return;
        this.log("host stream error; reconnecting:", String(e?.message ?? e));
      }
      if (this.ac.signal.aborted) return;
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS));
    }
  }
};

// src/routes.ts
import { randomUUID as randomUUID2 } from "node:crypto";
var DEFAULT_TIMEOUT_MS = 3e5;
var MAX_TIMEOUT_MS = 6e5;
function json(res, code, body) {
  res.writeHead(code, { "content-type": "application/json" });
  res.end(JSON.stringify(body));
}
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (e) {
        reject(e);
      }
    });
    req.on("error", reject);
  });
}
function rpcErr(result) {
  return result.ok ? "" : `${result.error?.code ?? "error"}: ${result.error?.message ?? ""}`;
}
function extractText(ev) {
  let out = "";
  for (const b of ev.data?.message?.content ?? []) {
    if (b.type === "text" && b.text) out += (out ? "\n" : "") + b.text;
  }
  return out;
}
var SseWriter = class {
  constructor(res, req) {
    this.res = res;
    res.writeHead(200, {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
      "x-accel-buffering": "no"
    });
    res.write(": connected\n\n");
    req.on("close", () => {
      this.closed = true;
    });
  }
  closed = false;
  get isClosed() {
    return this.closed;
  }
  send(event, data) {
    if (this.closed) return;
    this.res.write(`event: ${event}
data: ${JSON.stringify(data)}

`);
  }
  end() {
    if (!this.closed) this.res.end();
    this.closed = true;
  }
};
function sseFrameName(f) {
  switch (f.kind) {
    case "event":
      return "session/event";
    case "question":
      return "question";
    case "question-resolved":
      return "question-resolved";
    case "approval":
      return "approval";
    case "approval-resolved":
      return "approval-resolved";
    case "status":
      return "status";
    case "agent-error":
      return "agent-error";
    case "stream-error":
      return "stream-error";
  }
}
function sseFrameData(f) {
  switch (f.kind) {
    case "event":
      return f.event;
    case "question":
      return { rpcId: f.rpcId, questions: f.questions };
    case "question-resolved":
      return { rpcId: f.rpcId, outcome: f.outcome };
    case "approval":
      return { rpcId: f.rpcId, approvalId: f.approvalId, toolName: f.toolName, reason: f.reason };
    case "approval-resolved":
      return { approvalId: f.approvalId, outcome: f.outcome };
    case "status":
      return { running: f.running };
    case "agent-error":
      return { message: f.message };
    case "stream-error":
      return { message: f.message };
  }
}
function makeHandlers(deps) {
  const { apiProxy, hub, sessions, apiKeys } = deps;
  const req0 = (payload) => ({ rpcId: randomUUID2(), payload });
  const authorized = (req) => {
    if (!apiKeys.length) return false;
    const h = req.headers.authorization ?? "";
    const m = /^Bearer\s+(.+)$/i.exec(h);
    return !!m && apiKeys.includes(m[1].trim());
  };
  const health = (_req, res) => json(res, 200, { ok: true, service: "dsh-server-api", version: "0.1.0", time: Date.now() });
  const createSession = async (req, res) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: "unauthorized" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { ok: false, error: "bad-json" });
    }
    const workspace = process.env.DSH_WORKSPACE || process.cwd();
    const payload = {
      cwd: typeof body.cwd === "string" ? body.cwd : workspace
    };
    if (typeof body.sessionId === "string") payload.sessionId = body.sessionId;
    let r = await apiProxy.sessions.create(req0(payload));
    if (!r.result.ok && r.result.error.code === "session-conflict" && payload.sessionId) {
      const existingCwd = r.result.error.details?.existingCwd;
      if (existingCwd) {
        r = await apiProxy.sessions.create(req0({ sessionId: payload.sessionId, cwd: existingCwd }));
      }
    }
    if (!r.result.ok) return json(res, 500, { ok: false, error: rpcErr(r.result) });
    sessions.add(r.result.value.sessionId);
    json(res, 200, { ok: true, sessionId: r.result.value.sessionId, agentPreset: r.result.value.agentPreset });
  };
  const messages = async (req, res, sessionId) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: "unauthorized" });
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: "session-not-registered" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { ok: false, error: "bad-json" });
    }
    const text = typeof body.text === "string" ? body.text : "";
    if (!text) return json(res, 400, { ok: false, error: "text required" });
    const mode = body.mode === "steer" ? "steer" : "queue";
    const wantsStream = body.stream === true || String(req.headers.accept ?? "").includes("text/event-stream");
    const timeoutMs = Math.min(
      typeof body.timeoutMs === "number" && body.timeoutMs > 0 ? body.timeoutMs : DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS
    );
    const buffer = [];
    let notify = null;
    const unsubscribe = hub.subscribe(sessionId, (f) => {
      buffer.push(f);
      if (notify) {
        const n = notify;
        notify = null;
        n();
      }
    });
    const nextFrame = () => {
      if (buffer.length) return Promise.resolve(buffer.shift());
      return new Promise((resolve) => {
        notify = () => resolve(buffer.shift());
      });
    };
    const prompted = await apiProxy.sessions.prompt(
      req0({ sessionId, mode, content: [{ type: "text", text }] })
    );
    if (!prompted.result.ok) {
      unsubscribe();
      return json(res, 500, { ok: false, stage: "prompt", error: rpcErr(prompted.result) });
    }
    const started = Date.now();
    const deadline = started + timeoutMs;
    let answer = "";
    let turnEnded = false;
    let timedOut = false;
    const consumeUntilTurnEnd = async (onFrame) => {
      while (true) {
        const remain = deadline - Date.now();
        if (remain <= 0) {
          timedOut = true;
          return;
        }
        const f = await Promise.race([
          nextFrame(),
          new Promise((r) => setTimeout(() => r(null), remain))
        ]);
        if (f === null) {
          timedOut = true;
          return;
        }
        onFrame?.(f);
        if (f.kind === "event") {
          if (f.event.type === "assistant/message") {
            const t = extractText(f.event);
            if (t) answer += (answer ? "\n" : "") + t;
          } else if (f.event.type === "turn/end") {
            turnEnded = true;
            return;
          }
        }
      }
    };
    if (wantsStream) {
      const sse = new SseWriter(res, req);
      hub.replayPending(sessionId, (f) => sse.send(sseFrameName(f), sseFrameData(f)));
      try {
        await consumeUntilTurnEnd((f) => sse.send(sseFrameName(f), sseFrameData(f)));
        sse.send("done", { ok: turnEnded, timedOut, ms: Date.now() - started });
      } catch (e) {
        sse.send("error", { message: String(e?.message ?? e) });
      } finally {
        unsubscribe();
        sse.end();
      }
      return;
    }
    try {
      await consumeUntilTurnEnd();
      json(res, 200, { ok: turnEnded, timedOut, sessionId, text: answer, ms: Date.now() - started });
    } catch (e) {
      json(res, 500, { ok: false, error: String(e?.message ?? e) });
    } finally {
      unsubscribe();
    }
  };
  const history = async (req, res, sessionId) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: "unauthorized" });
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: "session-not-registered" });
    const url = new URL(req.url ?? "/", "http://local");
    const maxMessages = Number(url.searchParams.get("maxMessages") ?? "50");
    const r = await apiProxy.sessions.history(req0({ sessionId, maxMessages: Number.isFinite(maxMessages) ? maxMessages : 50 }));
    if (!r.result.ok) return json(res, 500, { ok: false, error: rpcErr(r.result) });
    json(res, 200, { ok: true, hasMore: r.result.value.hasMore, events: r.result.value.events.map((e) => e.event) });
  };
  const cancel = async (req, res, sessionId) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: "unauthorized" });
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: "session-not-registered" });
    const r = await apiProxy.sessions.cancel(req0({ sessionId }));
    if (!r.result.ok) return json(res, 500, { ok: false, error: rpcErr(r.result) });
    json(res, 200, { ok: true });
  };
  const answerQuestion = async (req, res, sessionId) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: "unauthorized" });
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: "session-not-registered" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { ok: false, error: "bad-json" });
    }
    const rpcId = typeof body.rpcId === "string" ? body.rpcId : "";
    const answers = Array.isArray(body.answers) ? body.answers : null;
    if (!rpcId || !answers) return json(res, 400, { ok: false, error: "rpcId + answers required" });
    const receipt = await apiProxy.respond({
      type: "client-response",
      rpcId,
      result: { ok: true, value: { sessionId, answer: { answers } } }
    });
    if (!receipt.accepted) return json(res, 409, { ok: false, error: receipt.reason });
    json(res, 200, { ok: true });
  };
  const answerApproval = async (req, res, sessionId) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: "unauthorized" });
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: "session-not-registered" });
    let body;
    try {
      body = await readBody(req);
    } catch {
      return json(res, 400, { ok: false, error: "bad-json" });
    }
    const rpcId = typeof body.rpcId === "string" ? body.rpcId : "";
    const approvalId = typeof body.approvalId === "string" ? body.approvalId : "";
    const outcome = body.outcome === "rejected" ? "rejected" : body.outcome === "allowed-once" ? "allowed-once" : "";
    if (!rpcId || !approvalId || !outcome) {
      return json(res, 400, { ok: false, error: "rpcId + approvalId + outcome(allowed-once|rejected) required" });
    }
    const receipt = await apiProxy.respond({
      type: "client-response",
      rpcId,
      result: { ok: true, value: { sessionId, approvalId, outcome } }
    });
    if (!receipt.accepted) return json(res, 409, { ok: false, error: receipt.reason });
    json(res, 200, { ok: true });
  };
  const sessionsRoot = (req, res) => {
    if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
    return createSession(req, res);
  };
  const sessionsSub = (req, res) => {
    const path = (req.url ?? "/").split("?")[0];
    const m = /^\/v1\/sessions\/([^/]+)\/(messages|history|cancel|answers|approvals)$/.exec(path);
    if (!m) return json(res, 404, { ok: false, error: "not-found" });
    const [, sessionId, action] = m;
    switch (action) {
      case "messages":
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
        return messages(req, res, sessionId);
      case "history":
        if (req.method !== "GET") return json(res, 405, { ok: false, error: "method-not-allowed" });
        return history(req, res, sessionId);
      case "cancel":
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
        return cancel(req, res, sessionId);
      case "answers":
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
        return answerQuestion(req, res, sessionId);
      case "approvals":
        if (req.method !== "POST") return json(res, 405, { ok: false, error: "method-not-allowed" });
        return answerApproval(req, res, sessionId);
    }
  };
  return { health, sessionsRoot, sessionsSub };
}

// src/index.ts
var name = "dsh-server-api";
var inject = ["webServer", "apiProxy"];
function apply(ctx) {
  const log = (...a) => console.log("[dsh-server]", ...a);
  const apiKeys = (process.env.DSH_API_KEYS ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (!apiKeys.length) {
    log("WARNING: DSH_API_KEYS not set \u2014 all protected routes will answer 503");
  }
  const hub = new MuxHub(ctx.apiProxy, log);
  hub.start();
  const sessions = /* @__PURE__ */ new Set();
  const { health, sessionsRoot, sessionsSub } = makeHandlers({
    apiProxy: ctx.apiProxy,
    hub,
    sessions,
    apiKeys,
    log
  });
  ctx.webServer.register({ kind: "exact", path: "/v1/health", handler: health });
  ctx.webServer.register({ kind: "exact", path: "/v1/sessions", handler: sessionsRoot });
  ctx.webServer.register({ kind: "prefix", path: "/v1/sessions", handler: sessionsSub });
  log(`routes ready (/v1/health, /v1/sessions/*); apiKeys=${apiKeys.length}`);
}
export {
  apply,
  inject,
  name
};
