/**
 * /v1 HTTP surface — the self-defined contract external Agent clients consume.
 * Auth: Bearer API keys from DAF_API_KEYS (comma-separated). Fail-closed: with
 * no keys configured, every protected route answers 503.
 */
import { randomUUID } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { MuxHub, OutFrame } from './hub.js'
import type { ApiProxy, SessionEventLike } from './types.js'

const DEFAULT_TIMEOUT_MS = 300_000
const MAX_TIMEOUT_MS = 600_000

export interface RouteDeps {
  apiProxy: ApiProxy
  hub: MuxHub
  sessions: Set<string>
  apiKeys: string[]
  log: (...a: unknown[]) => void
}

// ---- small http helpers ----------------------------------------------------

function json(res: ServerResponse, code: number, body: unknown): void {
  res.writeHead(code, { 'content-type': 'application/json' })
  res.end(JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    req.on('data', (c: Buffer) => chunks.push(c))
    req.on('end', () => {
      if (!chunks.length) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}

function rpcErr(result: { ok: boolean; error?: { code: string; message: string } }): string {
  return result.ok ? '' : `${result.error?.code ?? 'error'}: ${result.error?.message ?? ''}`
}

function extractText(ev: SessionEventLike): string {
  let out = ''
  for (const b of ev.data?.message?.content ?? []) {
    if (b.type === 'text' && b.text) out += (out ? '\n' : '') + b.text
  }
  return out
}

// ---- SSE -------------------------------------------------------------------

class SseWriter {
  private closed = false
  constructor(private res: ServerResponse, req: IncomingMessage) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    })
    res.write(': connected\n\n')
    req.on('close', () => {
      this.closed = true
    })
  }
  get isClosed(): boolean {
    return this.closed
  }
  send(event: string, data: unknown): void {
    if (this.closed) return
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  end(): void {
    if (!this.closed) this.res.end()
    this.closed = true
  }
}

function sseFrameName(f: OutFrame): string {
  switch (f.kind) {
    case 'event':
      return 'session/event'
    case 'question':
      return 'question'
    case 'question-resolved':
      return 'question-resolved'
    case 'approval':
      return 'approval'
    case 'approval-resolved':
      return 'approval-resolved'
    case 'status':
      return 'status'
    case 'agent-error':
      return 'agent-error'
    case 'stream-error':
      return 'stream-error'
  }
}

function sseFrameData(f: OutFrame): unknown {
  switch (f.kind) {
    case 'event':
      return f.event
    case 'question':
      return { rpcId: f.rpcId, questions: f.questions }
    case 'question-resolved':
      return { rpcId: f.rpcId, outcome: f.outcome }
    case 'approval':
      return { rpcId: f.rpcId, approvalId: f.approvalId, toolName: f.toolName, reason: f.reason }
    case 'approval-resolved':
      return { approvalId: f.approvalId, outcome: f.outcome }
    case 'status':
      return { running: f.running }
    case 'agent-error':
      return { message: f.message }
    case 'stream-error':
      return { message: f.message }
  }
}

// ---- route handlers --------------------------------------------------------

export function makeHandlers(deps: RouteDeps) {
  const { apiProxy, hub, sessions, apiKeys } = deps
  const req0 = <P>(payload: P) => ({ rpcId: randomUUID(), payload })

  const authorized = (req: IncomingMessage): boolean => {
    if (!apiKeys.length) return false
    const h = req.headers.authorization ?? ''
    const m = /^Bearer\s+(.+)$/i.exec(h)
    return !!m && apiKeys.includes(m[1].trim())
  }

  const health = (_req: IncomingMessage, res: ServerResponse) =>
    json(res, 200, { ok: true, service: 'daf-server-api', version: '0.1.0', time: Date.now() })

  const createSession = async (req: IncomingMessage, res: ServerResponse) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: 'unauthorized' })
    let body: Record<string, unknown>
    try {
      body = await readBody(req)
    } catch {
      return json(res, 400, { ok: false, error: 'bad-json' })
    }
    const workspace = process.env.DAF_WORKSPACE || process.cwd()
    const payload: { sessionId?: string; cwd?: string } = {
      cwd: typeof body.cwd === 'string' ? body.cwd : workspace,
    }
    if (typeof body.sessionId === 'string') payload.sessionId = body.sessionId
    let r = await apiProxy.sessions.create(req0(payload))
    if (!r.result.ok && r.result.error.code === 'session-conflict' && payload.sessionId) {
      // Resume path: the session exists with its original cwd — retry with it.
      const existingCwd = (r.result.error.details as { existingCwd?: string } | undefined)?.existingCwd
      if (existingCwd) {
        r = await apiProxy.sessions.create(req0({ sessionId: payload.sessionId, cwd: existingCwd }))
      }
    }
    if (!r.result.ok) return json(res, 500, { ok: false, error: rpcErr(r.result) })
    sessions.add(r.result.value.sessionId)
    json(res, 200, { ok: true, sessionId: r.result.value.sessionId, agentPreset: r.result.value.agentPreset })
  }

  /** POST /v1/sessions/:id/messages — SSE when stream:true (or Accept: text/event-stream). */
  const messages = async (req: IncomingMessage, res: ServerResponse, sessionId: string) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: 'unauthorized' })
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: 'session-not-registered' })
    let body: Record<string, unknown>
    try {
      body = await readBody(req)
    } catch {
      return json(res, 400, { ok: false, error: 'bad-json' })
    }
    const text = typeof body.text === 'string' ? body.text : ''
    if (!text) return json(res, 400, { ok: false, error: 'text required' })
    const mode = body.mode === 'steer' ? 'steer' : 'queue'
    const wantsStream = body.stream === true || String(req.headers.accept ?? '').includes('text/event-stream')
    const timeoutMs = Math.min(
      typeof body.timeoutMs === 'number' && body.timeoutMs > 0 ? body.timeoutMs : DEFAULT_TIMEOUT_MS,
      MAX_TIMEOUT_MS,
    )

    // Subscribe BEFORE prompt so no frame is lost.
    const buffer: OutFrame[] = []
    let notify: (() => void) | null = null
    const unsubscribe = hub.subscribe(sessionId, (f) => {
      buffer.push(f)
      if (notify) {
        const n = notify
        notify = null
        n()
      }
    })
    const nextFrame = (): Promise<OutFrame> => {
      if (buffer.length) return Promise.resolve(buffer.shift()!)
      return new Promise((resolve) => {
        notify = () => resolve(buffer.shift()!)
      })
    }

    const prompted = await apiProxy.sessions.prompt(
      req0({ sessionId, mode, content: [{ type: 'text', text }] }),
    )
    if (!prompted.result.ok) {
      unsubscribe()
      return json(res, 500, { ok: false, stage: 'prompt', error: rpcErr(prompted.result) })
    }

    const started = Date.now()
    const deadline = started + timeoutMs
    let answer = ''
    let turnEnded = false
    let timedOut = false

    const consumeUntilTurnEnd = async (onFrame?: (f: OutFrame) => void): Promise<void> => {
      while (true) {
        const remain = deadline - Date.now()
        if (remain <= 0) {
          timedOut = true
          return
        }
        const f = await Promise.race([
          nextFrame(),
          new Promise<null>((r) => setTimeout(() => r(null), remain)),
        ])
        if (f === null) {
          timedOut = true
          return
        }
        onFrame?.(f)
        if (f.kind === 'event') {
          if (f.event.type === 'assistant/message') {
            const t = extractText(f.event)
            if (t) answer += (answer ? '\n' : '') + t
          } else if (f.event.type === 'turn/end') {
            turnEnded = true
            return
          }
        }
      }
    }

    if (wantsStream) {
      const sse = new SseWriter(res, req)
      hub.replayPending(sessionId, (f) => sse.send(sseFrameName(f), sseFrameData(f)))
      try {
        await consumeUntilTurnEnd((f) => sse.send(sseFrameName(f), sseFrameData(f)))
        sse.send('done', { ok: turnEnded, timedOut, ms: Date.now() - started })
      } catch (e) {
        sse.send('error', { message: String((e as Error)?.message ?? e) })
      } finally {
        unsubscribe()
        sse.end()
      }
      return
    }

    try {
      await consumeUntilTurnEnd()
      json(res, 200, { ok: turnEnded, timedOut, sessionId, text: answer, ms: Date.now() - started })
    } catch (e) {
      json(res, 500, { ok: false, error: String((e as Error)?.message ?? e) })
    } finally {
      unsubscribe()
    }
  }

  const history = async (req: IncomingMessage, res: ServerResponse, sessionId: string) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: 'unauthorized' })
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: 'session-not-registered' })
    const url = new URL(req.url ?? '/', 'http://local')
    const maxMessages = Number(url.searchParams.get('maxMessages') ?? '50')
    const r = await apiProxy.sessions.history(req0({ sessionId, maxMessages: Number.isFinite(maxMessages) ? maxMessages : 50 }))
    if (!r.result.ok) return json(res, 500, { ok: false, error: rpcErr(r.result) })
    json(res, 200, { ok: true, hasMore: r.result.value.hasMore, events: r.result.value.events.map((e) => e.event) })
  }

  const cancel = async (req: IncomingMessage, res: ServerResponse, sessionId: string) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: 'unauthorized' })
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: 'session-not-registered' })
    const r = await apiProxy.sessions.cancel(req0({ sessionId }))
    if (!r.result.ok) return json(res, 500, { ok: false, error: rpcErr(r.result) })
    json(res, 200, { ok: true })
  }

  const answerQuestion = async (req: IncomingMessage, res: ServerResponse, sessionId: string) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: 'unauthorized' })
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: 'session-not-registered' })
    let body: Record<string, unknown>
    try {
      body = await readBody(req)
    } catch {
      return json(res, 400, { ok: false, error: 'bad-json' })
    }
    const rpcId = typeof body.rpcId === 'string' ? body.rpcId : ''
    const answers = Array.isArray(body.answers) ? body.answers : null
    if (!rpcId || !answers) return json(res, 400, { ok: false, error: 'rpcId + answers required' })
    const receipt = await apiProxy.respond({
      type: 'client-response',
      rpcId,
      result: { ok: true, value: { sessionId, answer: { answers } } },
    })
    if (!receipt.accepted) return json(res, 409, { ok: false, error: receipt.reason })
    json(res, 200, { ok: true })
  }

  const answerApproval = async (req: IncomingMessage, res: ServerResponse, sessionId: string) => {
    if (!authorized(req)) return json(res, apiKeys.length ? 401 : 503, { ok: false, error: 'unauthorized' })
    if (!sessions.has(sessionId)) return json(res, 404, { ok: false, error: 'session-not-registered' })
    let body: Record<string, unknown>
    try {
      body = await readBody(req)
    } catch {
      return json(res, 400, { ok: false, error: 'bad-json' })
    }
    const rpcId = typeof body.rpcId === 'string' ? body.rpcId : ''
    const approvalId = typeof body.approvalId === 'string' ? body.approvalId : ''
    const outcome = body.outcome === 'rejected' ? 'rejected' : body.outcome === 'allowed-once' ? 'allowed-once' : ''
    if (!rpcId || !approvalId || !outcome) {
      return json(res, 400, { ok: false, error: 'rpcId + approvalId + outcome(allowed-once|rejected) required' })
    }
    const receipt = await apiProxy.respond({
      type: 'client-response',
      rpcId,
      result: { ok: true, value: { sessionId, approvalId, outcome } },
    })
    if (!receipt.accepted) return json(res, 409, { ok: false, error: receipt.reason })
    json(res, 200, { ok: true })
  }

  /** exact /v1/sessions — POST create only. */
  const sessionsRoot = (req: IncomingMessage, res: ServerResponse) => {
    if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
    return createSession(req, res)
  }

  /** prefix /v1/sessions — /:id/(messages|history|cancel|answers|approvals). */
  const sessionsSub = (req: IncomingMessage, res: ServerResponse) => {
    const path = (req.url ?? '/').split('?')[0]
    const m = /^\/v1\/sessions\/([^/]+)\/(messages|history|cancel|answers|approvals)$/.exec(path)
    if (!m) return json(res, 404, { ok: false, error: 'not-found' })
    const [, sessionId, action] = m
    switch (action) {
      case 'messages':
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        return messages(req, res, sessionId)
      case 'history':
        if (req.method !== 'GET') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        return history(req, res, sessionId)
      case 'cancel':
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        return cancel(req, res, sessionId)
      case 'answers':
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        return answerQuestion(req, res, sessionId)
      case 'approvals':
        if (req.method !== 'POST') return json(res, 405, { ok: false, error: 'method-not-allowed' })
        return answerApproval(req, res, sessionId)
    }
  }

  return { health, sessionsRoot, sessionsSub }
}
