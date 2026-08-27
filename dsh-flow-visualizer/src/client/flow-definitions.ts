// 会话事件 → 数据流视图节点。v0.4 服务端 collector 状态机的客户端契约移植：
// 数据走宿主会话通道（session event firehose），不再依赖 SSE/iframe。

export interface FlowLiteEvent {
  type: string
  seq: number
  time: number
  plugin: string
  duration: number | null
  data: unknown
}

export interface FlowStepState {
  turn: number
  step: number
  startSeq: number
  startTime: number
  endTime: number | null
  status: 'running' | 'completed'
  tokens: { input: number; output: number } | null
  events: FlowLiteEvent[]
}

export interface FlowUserState {
  seq: number
  time: number
  source: string
  text: string
}

const STEP_UPDATE_TYPES = new Set(['assistant/message', 'tool/call', 'tool/result', 'step/end'])

function pluginOf(event: any): string {
  const d = event?.data
  switch (event?.type) {
    case 'assistant/message': {
      const src = d?.message?.source
      if (src?.provider && src?.model) return `${src.provider}/${src.model}`
      return src?.provider ?? src?.plugin ?? ''
    }
    case 'tool/call':
      return d?.name ?? ''
    case 'tool/result':
      return ''
    case 'user/message': {
      const src = d?.source
      if (src?.plugin) return src.plugin
      return src?.kind === 'user' ? 'user' : ''
    }
    default:
      return ''
  }
}

function pickData(event: any): unknown {
  const d = event?.data
  switch (event?.type) {
    case 'tool/call':
      return { callId: d?.callId, name: d?.name, arguments: d?.arguments }
    case 'tool/result':
      return { message: d?.message?.content }
    case 'assistant/message':
      return { usage: d?.usage, content: d?.message?.content }
    case 'user/message':
      return { content: d?.content, source: d?.source }
    case 'step/start':
    case 'step/end':
      return { turn: d?.turn, step: d?.step }
    default:
      return d
  }
}

function textOf(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((b: any) => (b?.type === 'text' && typeof b.text === 'string' ? b.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

function lite(event: any): FlowLiteEvent {
  return {
    type: event.type,
    seq: event.seq,
    time: event.time,
    plugin: pluginOf(event),
    duration: null,
    data: pickData(event),
  }
}

/** 每个 agent step 一个节点：累积模型/工具/用户事件，step/end 收尾。 */
export const flowStepDefinition = {
  kind: 'flow-step',
  target: 'flow',
  match: (event: any) => {
    const d = event?.data
    if (d?.turn === undefined || d?.step === undefined) return null
    if (event?.type === 'step/start') return { id: `${d.turn}:${d.step}`, role: 'start' as const }
    if (STEP_UPDATE_TYPES.has(event?.type)) return { id: `${d.turn}:${d.step}`, role: 'update' as const }
    return null
  },
  start: (_context: any, match: any): FlowStepState => {
    const e = match.event
    return {
      turn: e.data.turn,
      step: e.data.step,
      startSeq: e.seq,
      startTime: e.time,
      endTime: null,
      status: 'running',
      tokens: null,
      events: [lite(e)],
    }
  },
  update: (context: any, match: any): FlowStepState => {
    const prev: FlowStepState = context.state
    const e = match.event
    const state: FlowStepState = { ...prev, events: [...prev.events, lite(e)] }
    if (e.type === 'step/end') {
      state.endTime = e.time
      state.status = 'completed'
    }
    if (e.type === 'assistant/message') {
      const u = e.data?.usage
      if (u && !state.tokens) state.tokens = { input: u.inputTokens ?? 0, output: u.outputTokens ?? 0 }
    }
    return state
  },
  buildViewNode: (context: any) => {
    const state: FlowStepState | undefined = context.state
    if (!state) return null
    return {
      key: context.key,
      kind: context.kind,
      id: context.id,
      target: 'flow',
      anchorSeq: state.startSeq,
      location: context.start?.location ?? { kind: 'unresolved' },
      data: state,
    }
  },
}

/** 用户消息节点（可能不带 turn/step，独立成节点）。 */
export const flowUserDefinition = {
  kind: 'flow-user',
  target: 'flow',
  match: (event: any) => {
    if (event?.type !== 'user/message') return null
    const src = event.data?.source
    if (src?.plugin) return null // 插件注入的上下文不算用户输入
    return { id: `user:${event.seq}`, role: 'start' as const }
  },
  start: (_context: any, match: any): FlowUserState => {
    const e = match.event
    return {
      seq: e.seq,
      time: e.time,
      source: e.data?.source?.kind ?? 'user',
      text: textOf(e.data?.content),
    }
  },
  update: (_context: any, _match: any) => _context.state,
  buildViewNode: (context: any) => {
    const state: FlowUserState | undefined = context.state
    if (!state) return null
    return {
      key: context.key,
      kind: context.kind,
      id: context.id,
      target: 'flow',
      anchorSeq: state.seq,
      location: context.start?.location ?? { kind: 'unresolved' },
      data: state,
    }
  },
}
