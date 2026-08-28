/**
 * MuxHub: ONE shared mux stream + ONE host stream for the whole process,
 * dispatching frames to per-session listeners. (The Phase 0 spike opened a mux
 * per request — that does not scale; this is the Phase 1 design.)
 */
import { randomUUID } from 'node:crypto'
import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, SessionEventLike } from './types.js'

export type OutFrame =
  | { kind: 'event'; event: SessionEventLike }
  | { kind: 'question'; rpcId: string; questions: unknown }
  | { kind: 'question-resolved'; rpcId: string; outcome?: string }
  | { kind: 'approval'; rpcId: string; approvalId?: string; toolName?: string; reason?: string }
  | { kind: 'approval-resolved'; approvalId?: string; outcome?: string }
  | { kind: 'status'; running: boolean }
  | { kind: 'agent-error'; message: string }
  | { kind: 'stream-error'; message: string }

type Listener = (frame: OutFrame) => void

const RECONNECT_DELAY_MS = 1_000

export class MuxHub {
  private listeners = new Map<string, Set<Listener>>()
  /** sessionId -> (rpcId -> pending interaction frame); mux replays these on reopen. */
  private pending = new Map<string, Map<string, { kind: 'question' | 'approval'; frame: OutFrame }>>()
  private ac = new AbortController()
  private started = false

  constructor(
    private apiProxy: ApiProxy,
    private log: (...a: unknown[]) => void,
  ) {}

  start(): void {
    if (this.started) return
    this.started = true
    void this.runMux()
    void this.runHost()
  }

  stop(): void {
    this.ac.abort()
  }

  subscribe(sessionId: string, listener: Listener): () => void {
    let set = this.listeners.get(sessionId)
    if (!set) {
      set = new Set()
      this.listeners.set(sessionId, set)
    }
    set.add(listener)
    return () => {
      set.delete(listener)
      if (!set.size) this.listeners.delete(sessionId)
    }
  }

  /** Replay still-pending question/approval frames to a fresh subscriber. */
  replayPending(sessionId: string, listener: Listener): void {
    const map = this.pending.get(sessionId)
    if (!map) return
    for (const { frame } of map.values()) {
      try {
        listener(frame)
      } catch (e) {
        this.log('listener error', e)
      }
    }
  }

  private dispatch(sessionId: string | undefined, frame: OutFrame): void {
    if (!sessionId) return
    const set = this.listeners.get(sessionId)
    if (!set) return
    for (const l of set) {
      try {
        l(frame)
      } catch (e) {
        this.log('listener error', e)
      }
    }
  }

  private broadcast(frame: OutFrame): void {
    for (const set of this.listeners.values()) {
      for (const l of set) {
        try {
          l(frame)
        } catch (e) {
          this.log('listener error', e)
        }
      }
    }
  }

  private trackPending(sessionId: string | undefined, rpcId: string, kind: 'question' | 'approval', frame: OutFrame): void {
    if (!sessionId) return
    let map = this.pending.get(sessionId)
    if (!map) {
      map = new Map()
      this.pending.set(sessionId, map)
    }
    map.set(rpcId, { kind, frame })
  }

  private untrackPending(sessionId: string | undefined, rpcId: string): void {
    const map = sessionId ? this.pending.get(sessionId) : undefined
    map?.delete(rpcId)
  }

  private onMux(req: RpcRequest<MuxFrame>): void {
    const p = req.payload
    if (!p || typeof p.type !== 'string') return
    switch (p.type) {
      case 'session/event':
        if (p.event && typeof p.event.type === 'string') {
          this.dispatch(p.sessionId, { kind: 'event', event: p.event })
        }
        return
      case 'question/requested': {
        const frame: OutFrame = { kind: 'question', rpcId: req.rpcId, questions: p.questions }
        this.trackPending(p.sessionId, req.rpcId, 'question', frame)
        this.dispatch(p.sessionId, frame)
        return
      }
      case 'question/resolved':
        if (p.questionRpcId) this.untrackPending(p.sessionId, p.questionRpcId)
        this.dispatch(p.sessionId, { kind: 'question-resolved', rpcId: p.questionRpcId ?? '', outcome: p.outcome })
        return
      case 'approval/requested': {
        const frame: OutFrame = {
          kind: 'approval',
          rpcId: req.rpcId,
          approvalId: p.approvalId,
          toolName: p.toolName,
          reason: p.reason,
        }
        this.trackPending(p.sessionId, req.rpcId, 'approval', frame)
        this.dispatch(p.sessionId, frame)
        return
      }
      case 'approval/resolved': {
        const map = p.sessionId ? this.pending.get(p.sessionId) : undefined
        if (map) {
          for (const [rpcId, entry] of [...map]) {
            if (entry.kind === 'approval') map.delete(rpcId)
          }
        }
        this.dispatch(p.sessionId, { kind: 'approval-resolved', approvalId: p.approvalId, outcome: p.outcome })
        return
      }
      case 'stream/error':
        this.broadcast({ kind: 'stream-error', message: p.error?.message ?? 'stream error' })
        return
      default:
        // session/subscribed, session/queue, session/projection, ... — not part of
        // the Phase 1 contract.
        return
    }
  }

  private onHost(req: RpcRequest<HostFrame>): void {
    const p = req.payload
    if (!p || typeof p.type !== 'string') return
    if (p.type === 'host/session-status' && typeof p.running === 'boolean') {
      this.dispatch(p.sessionId, { kind: 'status', running: p.running })
    } else if (p.type === 'host/agent-error') {
      this.dispatch(p.sessionId, { kind: 'agent-error', message: p.message ?? 'agent error' })
    }
  }

  private async runMux(): Promise<void> {
    while (!this.ac.signal.aborted) {
      try {
        const stream = this.apiProxy.events.mux({ rpcId: randomUUID(), payload: {} }, this.ac.signal)
        for await (const req of stream) this.onMux(req)
        this.log('mux stream ended; reopening')
      } catch (e) {
        if (this.ac.signal.aborted) return
        this.log('mux stream error; reconnecting:', String((e as Error)?.message ?? e))
      }
      if (this.ac.signal.aborted) return
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS))
    }
  }

  private async runHost(): Promise<void> {
    while (!this.ac.signal.aborted) {
      try {
        const stream = this.apiProxy.events.host({ rpcId: randomUUID(), payload: {} }, this.ac.signal)
        for await (const req of stream) this.onHost(req)
        this.log('host stream ended; reopening')
      } catch (e) {
        if (this.ac.signal.aborted) return
        this.log('host stream error; reconnecting:', String((e as Error)?.message ?? e))
      }
      if (this.ac.signal.aborted) return
      await new Promise((r) => setTimeout(r, RECONNECT_DELAY_MS))
    }
  }
}
