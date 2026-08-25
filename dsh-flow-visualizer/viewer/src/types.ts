export interface FlowEvent {
  id: string
  sessionId: string
  traceId: string
  parentId: string | null
  timestamp: number
  phase: string
  pluginName: string
  duration: number | null
  input: unknown
  output: unknown
  metadata: Record<string, unknown>
  status: 'running' | 'success' | 'error' | 'skipped'
}

export type TraceStatus = 'running' | 'completed' | 'failed'

export interface FlowTrace {
  traceId: string
  sessionId: string
  startTime: number
  endTime: number | null
  events: FlowEvent[]
  totalDuration: number | null
  totalTokens: { input: number; output: number } | null
  toolCallCount: number
  status: TraceStatus
}

export type ViewMode = 'timeline' | 'swimlane' | 'injection' | 'plugins'

/** 解析 "session-xxx:turn:step" */
export function parseTraceId(traceId: string): { sessionId: string; turn: string; step: string } {
  const i = traceId.lastIndexOf(':')
  if (i < 0) return { sessionId: traceId, turn: '', step: '' }
  const step = traceId.slice(i + 1)
  const rest = traceId.slice(0, i)
  const j = rest.lastIndexOf(':')
  if (j < 0) return { sessionId: traceId, turn: '', step: '' }
  const turn = rest.slice(j + 1)
  const sessionId = rest.slice(0, j)
  return { sessionId, turn, step }
}

export interface PluginNode {
  id: string
  name: string
  enabled: boolean
  phase: string
  inject: string[]
  provides: string[]
  group: boolean
  isolate: string | null
}
