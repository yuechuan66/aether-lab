import { create } from 'zustand'
import { parseTraceId, type FlowEvent, type FlowTrace, type TraceStatus, type ViewMode } from './types'

interface SessionData {
  name: string
  traces: Map<string, FlowTrace>
}

interface ViewerState {
  connected: boolean
  sessions: Map<string, SessionData>
  currentSessionId: string | null
  viewMode: ViewMode
  selectedEventId: string | null

  setConnected: (v: boolean) => void
  setViewMode: (mode: ViewMode) => void
  selectSession: (id: string) => void
  selectEvent: (id: string | null) => void
  upsertEvent: (ev: FlowEvent) => void
  applyTrace: (trace: FlowTrace) => void
  finishTrace: (traceId: string, status: TraceStatus) => void
}

function getOrCreateSession(state: ViewerState, sessionId: string): SessionData {
  let s = state.sessions.get(sessionId)
  if (!s) {
    s = { name: sessionId, traces: new Map() }
    state.sessions.set(sessionId, s)
  }
  return s
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  connected: false,
  sessions: new Map(),
  currentSessionId: null,
  viewMode: 'timeline',
  selectedEventId: null,

  setConnected: (v) => set({ connected: v }),
  setViewMode: (mode) => set({ viewMode: mode }),

  selectSession: (id) => set({ currentSessionId: id, selectedEventId: null }),
  selectEvent: (id) => set({ selectedEventId: id }),

  upsertEvent: (ev) => {
    const state = get()
    const { sessionId, turn, step } = parseTraceId(ev.traceId)
    const session = getOrCreateSession(state, sessionId)
    let trace = session.traces.get(ev.traceId)
    if (!trace) {
      trace = {
        traceId: ev.traceId,
        sessionId,
        startTime: ev.timestamp,
        endTime: null,
        events: [],
        totalDuration: null,
        totalTokens: null,
        toolCallCount: 0,
        status: 'running',
      }
      session.traces.set(ev.traceId, trace)
    }
    const existing = trace.events.find((x) => x.id === ev.id)
    if (existing) Object.assign(existing, ev)
    else trace.events.push(ev)

    const next = new Map(state.sessions)
    set({
      sessions: next,
      currentSessionId: state.currentSessionId ?? sessionId,
    })
  },

  applyTrace: (trace) => {
    const state = get()
    const { sessionId } = parseTraceId(trace.traceId)
    const session = getOrCreateSession(state, sessionId)
    let t = session.traces.get(trace.traceId)
    if (!t) {
      t = { ...trace, events: [] }
      session.traces.set(trace.traceId, t)
    }
    for (const ev of trace.events) {
      if (!t.events.find((x) => x.id === ev.id)) t.events.push(ev)
    }
    t.status = trace.status
    t.endTime = trace.endTime
    t.totalDuration = trace.totalDuration
    t.totalTokens = trace.totalTokens
    t.toolCallCount = trace.toolCallCount

    const next = new Map(state.sessions)
    set({
      sessions: next,
      currentSessionId: state.currentSessionId ?? sessionId,
    })
  },

  finishTrace: (traceId, status) => {
    const state = get()
    const { sessionId } = parseTraceId(traceId)
    const session = state.sessions.get(sessionId)
    if (!session) return
    const trace = session.traces.get(traceId)
    if (!trace) return
    trace.status = status
    trace.endTime = Date.now()
    trace.totalDuration = trace.endTime - trace.startTime
    const next = new Map(state.sessions)
    set({ sessions: next })
  },
}))

/** 会话事件在当前会话变化时才重算（供组件用 useMemo 包裹）。 */
export function getSessionEvents(state: ViewerState): Array<{ ev: FlowEvent; turn: string; step: string }> {
  const session = state.currentSessionId ? state.sessions.get(state.currentSessionId) : undefined
  if (!session) return []
  const all: Array<{ ev: FlowEvent; turn: string; step: string }> = []
  for (const trace of session.traces.values()) {
    const { turn, step } = parseTraceId(trace.traceId)
    for (const ev of trace.events) {
      all.push({ ev, turn, step })
    }
  }
  all.sort((a, b) => a.ev.timestamp - b.ev.timestamp)
  return all
}
