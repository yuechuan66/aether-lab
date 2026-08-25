import type { FlowEvent, FlowPhase, FlowTrace, SnapshotValue } from './types.ts'
import type { FlowConfig } from './types.ts'

export interface ResolvedConfig {
  enabled: boolean
  port: number
  transport: 'sse'
  maxBufferSize: number
  snapshotLimit: number
  sensitiveFields: string[]
  toolToPlugin: Record<string, string>
  autoOpen: boolean
}

/** 内置工具名 → 插件包名映射（scripts/gen-tool-map.py 生成，勿手改） */
const KNOWN_TOOL_TO_PLUGIN: Record<string, string> = {
  'ask_user_question': '@deepseek-ai/dsh-tool-ask-user',
  'bash': '@deepseek-ai/dsh-tool-bash',
  'cordis_define': '@deepseek-ai/dsh-tool-cordis',
  'cordis_inspect_list': '@deepseek-ai/dsh-tool-cordis',
  'cordis_inspect_query': '@deepseek-ai/dsh-tool-cordis',
  'cordis_inspect_self': '@deepseek-ai/dsh-tool-cordis',
  'cordis_run': '@deepseek-ai/dsh-tool-cordis',
  'cordis_stop': '@deepseek-ai/dsh-tool-cordis',
  'cordis_undefine': '@deepseek-ai/dsh-tool-cordis',
  'create_goal': '@deepseek-ai/dsh-tool-goal',
  'edit': '@deepseek-ai/dsh-tool-fs',
  'get_goal': '@deepseek-ai/dsh-tool-goal',
  'interrupt_agent': '@deepseek-ai/dsh-tool-subagent-control',
  'job_kill': '@deepseek-ai/dsh-tool-jobs',
  'job_list': '@deepseek-ai/dsh-tool-jobs',
  'job_output': '@deepseek-ai/dsh-tool-jobs',
  'list_agents': '@deepseek-ai/dsh-tool-subagent-control',
  'lsp': '@deepseek-ai/dsh-tool-lsp',
  'pwsh': '@deepseek-ai/dsh-tool-pwsh',
  'ralph': '@deepseek-ai/dsh-tool-ralph',
  'read': '@deepseek-ai/dsh-tool-fs',
  'read_image': '@deepseek-ai/dsh-tool-fs',
  'report': '@deepseek-ai/dsh-tool-subagent-report',
  'schedule_create': '@deepseek-ai/dsh-schedule',
  'schedule_delete': '@deepseek-ai/dsh-schedule',
  'schedule_list': '@deepseek-ai/dsh-schedule',
  'send_message': '@deepseek-ai/dsh-tool-subagent-control',
  'session_event_read': '@deepseek-ai/dsh-tool-session-query',
  'session_event_search': '@deepseek-ai/dsh-tool-session-query',
  'session_event_trace': '@deepseek-ai/dsh-tool-session-query',
  'session_search': '@deepseek-ai/dsh-tool-session-query',
  'session_trace': '@deepseek-ai/dsh-tool-session-query',
  'spawn_teammate': '@deepseek-ai/dsh-experimental-tool-agent-team',
  'str_replace_editor': '@deepseek-ai/dsh-tool-str-replace-editor',
  'team_task_create': '@deepseek-ai/dsh-experimental-tool-agent-team',
  'team_task_get': '@deepseek-ai/dsh-experimental-tool-agent-team',
  'team_task_list': '@deepseek-ai/dsh-experimental-tool-agent-team',
  'team_task_update': '@deepseek-ai/dsh-experimental-tool-agent-team',
  'terminal_close': '@deepseek-ai/dsh-tool-terminal',
  'terminal_list': '@deepseek-ai/dsh-tool-terminal',
  'terminal_open': '@deepseek-ai/dsh-tool-terminal',
  'terminal_read': '@deepseek-ai/dsh-tool-terminal',
  'terminal_send': '@deepseek-ai/dsh-tool-terminal',
  'terminal_signal': '@deepseek-ai/dsh-tool-terminal',
  'todo_write': '@deepseek-ai/dsh-tool-todo',
  'update_goal': '@deepseek-ai/dsh-tool-goal',
  'wait_agent': '@deepseek-ai/dsh-experimental-tool-agent-team',
  'web_fetch': '@deepseek-ai/dsh-tool-web',
  'web_search': '@deepseek-ai/dsh-tool-web',
  'write': '@deepseek-ai/dsh-tool-fs',
}

export function resolveConfig(config: Partial<FlowConfig> = {}): ResolvedConfig {
  return {
    enabled: config.enabled ?? true,
    port: config.port ?? 9527,
    transport: 'sse',
    maxBufferSize: config.maxBufferSize ?? 2000,
    snapshotLimit: config.snapshotLimit ?? 1024,
    sensitiveFields: config.sensitiveFields ?? ['api_key', 'token', 'password', 'authorization'],
    // 内置表兜底，用户配置覆盖
    toolToPlugin: { ...KNOWN_TOOL_TO_PLUGIN, ...config.toolToPlugin },
    autoOpen: config.autoOpen ?? false,
  }
}

export class Collector {
  private traces = new Map<string, FlowTrace>()
  private traceByStep = new Map<string, string>()
  private sequence = 0
  private readonly opts: ResolvedConfig
  private readonly sanitize: (value: unknown) => unknown
  private unmappedTools = new Set<string>()

  constructor(opts: ResolvedConfig, sanitize?: (value: unknown) => unknown) {
    this.opts = opts
    this.sanitize = sanitize ?? ((value: unknown) => value)
  }

  traceIds(): string[] {
    return [...this.traces.keys()]
  }

  getTrace(traceId: string): FlowTrace | undefined {
    return this.traces.get(traceId)
  }

  startTrace(sessionId: string, turn: number, step: number): string {
    const traceId = `${sessionId}:${turn}:${step}`
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
        status: 'running',
      })
    }
    this.traceByStep.set(`${sessionId}:${turn}:${step}`, traceId)
    return traceId
  }

  endTrace(sessionId: string, turn: number, step: number, status: FlowTrace['status']): void {
    const traceId = this.traceByStep.get(`${sessionId}:${turn}:${step}`)
    if (!traceId) return
    const trace = this.traces.get(traceId)
    if (!trace) return
    trace.endTime = Date.now()
    trace.totalDuration = trace.endTime - trace.startTime
    trace.status = status
  }

  removeSession(sessionId: string): void {
    for (const [key, traceId] of this.traceByStep) {
      if (key.startsWith(`${sessionId}:`)) {
        this.traceByStep.delete(key)
        const trace = this.traces.get(traceId)
        if (!trace || trace.status !== 'running') this.traces.delete(traceId)
      }
    }
  }

  record(phase: FlowPhase, payload: unknown, traceId?: string, pluginName?: string): FlowEvent | undefined {
    const event = this.createEvent(phase, payload)
    event.status = 'success'
    if (traceId) event.traceId = traceId
    if (pluginName) event.pluginName = pluginName
    this.push(event)
    return event
  }

  /** 工具名 → 插件名。命中映射表返回插件名，未命中记录到 unmappedTools 并返回工具名本身。 */
  resolveToolPlugin(name: string | undefined): string {
    if (!name) return ''
    const mapped = this.opts.toolToPlugin[name]
    if (mapped) return mapped
    this.unmappedTools.add(name)
    return name
  }

  /** 返回所有未命中映射表的工具名，供补全配置用。 */
  unmappedToolList(): string[] {
    return [...this.unmappedTools]
  }

  private createEvent(phase: FlowPhase, payload: unknown): FlowEvent {
    const input = this.snapshot(payload)
    return {
      id: `evt-${++this.sequence}`,
      sessionId: '',
      traceId: 'unknown',
      parentId: null,
      timestamp: Date.now(),
      phase,
      pluginName: '',
      duration: null,
      input,
      output: null,
      metadata: {},
      status: 'running',
    }
  }

  private push(event: FlowEvent): void {
    const trace = this.traces.get(event.traceId)
    if (!trace) return
    trace.events.push(event)
    if (trace.events.length > this.opts.maxBufferSize) trace.events.shift()
  }

  snapshot(value: unknown): SnapshotValue {
    if (value === undefined) return null
    const cleaned = this.sanitize(value)
    try {
      const str = JSON.stringify(cleaned)
      if (str === undefined) return null
      if (str.length > this.opts.snapshotLimit) {
        return str.slice(0, this.opts.snapshotLimit) + '...[truncated]'
      }
      return JSON.parse(str) as SnapshotValue
    } catch {
      return String(cleaned)
    }
  }
}
