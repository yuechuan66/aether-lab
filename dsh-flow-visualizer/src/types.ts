/** 单条数据流事件 */
export interface FlowEvent {
  id: string
  sessionId: string
  traceId: string
  parentId: string | null
  timestamp: number
  phase: FlowPhase
  pluginName: string
  duration: number | null
  input: SnapshotValue | null
  output: SnapshotValue | null
  metadata: Record<string, unknown>
  status: 'running' | 'success' | 'error' | 'skipped'
}

export type FlowPhase =
  | 'session.created'
  | 'agent.pre-step'
  | 'agent.request'
  | 'llm.stream'
  | 'tools.pre-execute'
  | 'tools.execute'
  | 'tools.post-execute'
  | 'tools.result'
  | 'session.event'
  | 'agent.request-error'
  | 'agent.error'
  | 'session.disposed'

export type SnapshotValue = string | number | boolean | object | null

/** 一次完整用户请求的 Trace */
export interface FlowTrace {
  traceId: string
  sessionId: string
  startTime: number
  endTime: number | null
  events: FlowEvent[]
  totalDuration: number | null
  totalTokens: { input: number; output: number } | null
  toolCallCount: number
  status: 'running' | 'completed' | 'failed'
}

export interface FlowConfig {
  enabled?: boolean
  /** Viewer 服务端口，默认 9527 */
  port?: number
  /** 当前仅支持 sse */
  transport?: 'sse'
  /** 每会话最大事件数（环形缓冲上限），默认 2000 */
  maxBufferSize?: number
  /** 快照截断字符数，默认 1024 */
  snapshotLimit?: number
  /** 自动脱敏字段名 */
  sensitiveFields?: string[]
  /** 工具名 → 插件名映射表（覆盖/补充内置表） */
  toolToPlugin?: Record<string, string>
  /** 启动时是否自动打开浏览器 Viewer，默认 false */
  autoOpen?: boolean
}

/** SSE 消息类型 */
export type SseMessageType = 'trace.list' | 'trace.init' | 'event' | 'trace.end'
