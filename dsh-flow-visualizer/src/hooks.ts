import type { Context, Events } from '@deepseek-ai/cordis'
import type { Collector } from './collector.ts'
import type { Emitter } from './emitter.ts'
import type { FlowPhase } from './types.ts'

type WaterfallEvent =
  | 'agent/pre-step'
  | 'agent/request'
  | 'tools/pre-execute'
  | 'tools/execute'
  | 'tools/post-execute'

const PHASE_BY_WATERFALL: Record<WaterfallEvent, FlowPhase> = {
  'agent/pre-step': 'agent.pre-step',
  'agent/request': 'agent.request',
  'tools/pre-execute': 'tools.pre-execute',
  'tools/execute': 'tools.execute',
  'tools/post-execute': 'tools.post-execute',
}

export function registerHooks(ctx: Context, collector: Collector, emitter: Emitter): void {
  let currentSessionId = ''
  let currentTraceId = ''
  let currentProvider = '' // 当前模型 provider（如 codemaker）

  for (const [event, phase] of Object.entries(PHASE_BY_WATERFALL)) {
    ctx.on(event as keyof Events, async function (this: unknown, ...args: unknown[]) {
      const next = args[args.length - 1]
      const firstArg = args[0]

      // 只提取可序列化的关键字段
      const input = pickWaterfallInput(phase, firstArg)

      if (phase === 'agent.pre-step' && currentSessionId && firstArg) {
        const turn = firstArg.turn
        const step = firstArg.step
        if (turn !== undefined && step !== undefined) {
          currentTraceId = collector.startTrace(currentSessionId, turn, step)
        }
      }

      // 计算插件/所属来源
      const pluginName = resolveWaterfallPlugin(collector, phase, firstArg)

      const traceId = currentTraceId || undefined
      const flowEvent = collector.record(phase, input, traceId, pluginName)
      const start = Date.now()
      try {
        const result = typeof next === 'function' ? await (next as () => Promise<unknown>)() : undefined
        if (flowEvent) {
          flowEvent.duration = Date.now() - start
          flowEvent.output = collector.snapshot(result)
          flowEvent.status = 'success'
        }
        if (flowEvent) emitter.emitEvent(flowEvent)
        return result
      } catch (error) {
        if (flowEvent) {
          flowEvent.duration = Date.now() - start
          flowEvent.status = 'error'
          flowEvent.metadata.error = error instanceof Error ? error.message : String(error)
        }
        if (flowEvent) emitter.emitEvent(flowEvent)
        throw error
      }
    })
  }

  ctx.on('llm/stream', function (this: unknown, options: any, next: () => AsyncIterable<unknown>) {
    if (options?.purpose) return next()
    if (currentTraceId) {
      currentProvider = options?.provider ?? currentProvider
      const provider = options?.provider ?? ''
      const model = options?.model ?? ''
      const flowEvent = collector.record('llm.stream', {
        provider,
        model,
        messages: options?.messages,
        system: options?.system,
        tools: options?.tools,
      }, currentTraceId, model ? `${provider}/${model}` : provider)
      if (flowEvent) emitter.emitEvent(flowEvent)
    }
    return next()
  })

  ctx.on('session/created', (session: any) => {
    currentSessionId = session?.id ?? ''
    collector.record('session.created', { id: session?.id })
  })

  ctx.on('session/event', (session: any, event: any) => {
    const sessionId = session?.id as string | undefined
    const type = event?.type as string | undefined
    if (sessionId) currentSessionId = sessionId
    if (type === 'assistant/chunk') return

    const data = event?.data
    const traceId = resolveTraceId(collector, sessionId, data)
    if (!traceId) return // 会话级事件（无 step 关联）丢弃
    currentTraceId = traceId

    if (type === 'step/start' && data?.turn !== undefined && data?.step !== undefined && sessionId) {
      collector.startTrace(sessionId, data.turn, data.step)
    }

    const pluginName = resolveSessionPlugin(collector, type, data)

    const flowEvent = collector.record(
      'session.event',
      { type, seq: event?.seq, time: event?.time, data: pickSessionData(type, data) },
      traceId,
      pluginName,
    )

    if (type === 'step/end' && data?.turn !== undefined && data?.step !== undefined && sessionId) {
      collector.endTrace(sessionId, data.turn, data.step, 'completed')
      emitter.emitTraceEnd(traceId, 'completed', null)
    }
    if (flowEvent) emitter.emitEvent(flowEvent)
  })

  ctx.on('tools/result', (exec: any, result: any) => {
    collector.record('tools.result', {
      callId: exec?.callId,
      rootCallId: exec?.rootCallId,
      name: exec?.name,
      arguments: exec?.arguments,
      result,
    }, currentTraceId || undefined, collector.resolveToolPlugin(exec?.name))
  })

  ctx.on('agent/request-error', function (this: unknown, payload: any, next: any) {
    collector.record('agent.request-error', pickAgentPayload(payload), currentTraceId || undefined, currentProvider)
    return typeof next === 'function' ? next() : undefined
  })

  ctx.on('agent/error', (payload: any) => {
    collector.record('agent.error', pickAgentPayload(payload), currentTraceId || undefined, currentProvider)
  })

  ctx.on('session/disposed', (session: any) => {
    collector.record('session.disposed', { id: session?.id })
    collector.removeSession(session?.id)
    currentSessionId = ''
    currentTraceId = ''
    currentProvider = ''
  })
}

/** 计算 waterfall 事件的插件归属。 */
function resolveWaterfallPlugin(collector: Collector, phase: FlowPhase, arg: any): string {
  if (!arg) return ''
  switch (phase) {
    case 'tools.pre-execute':
    case 'tools.execute':
    case 'tools.post-execute':
      // 工具：用映射表 tool name -> plugin name；未命中显示工具名
      return collector.resolveToolPlugin(arg.name)
    case 'agent.request':
    case 'agent.pre-step':
      // Agent 阶段：无插件归属，留空（由 llm.stream 的 provider/model 体现）
      return ''
    default:
      return ''
  }
}

/** 计算 session 事件的插件归属。 */
function resolveSessionPlugin(collector: Collector, type: string | undefined, data: any): string {
  if (!type || !data) return ''
  switch (type) {
    case 'tool/call':
      return collector.resolveToolPlugin(data.name)
    case 'tool/result': {
      const msg = data.message
      if (msg?.content) {
        for (const block of msg.content) {
          if (block?.type === 'tool-result' && block?.toolCallId) {
            // 无法直接反查工具名，从 callId 无从解析，返回空
          }
        }
      }
      return ''
    }
    case 'assistant/message': {
      const src = data.message?.source
      if (!src) return ''
      if (src.provider && src.model) return `${src.provider}/${src.model}`
      if (src.plugin) return src.plugin
      return src.provider ?? ''
    }
    case 'user/message': {
      const src = data.source
      if (!src) return ''
      if (src.plugin) return src.plugin
      if (src.kind === 'user') return 'user'
      return ''
    }
    case 'request/header':
      return data.header?.config?.provider ?? ''
    case 'session/title-llm-request':
      return data.route?.provider ?? ''
    default:
      return ''
  }
}

/** 只保留 waterfall payload 的可序列化关键字段。 */
function pickWaterfallInput(phase: FlowPhase, arg: any): unknown {
  if (!arg) return undefined
  switch (phase) {
    case 'agent.pre-step':
      return { messages: arg.messages, turn: arg.turn, step: arg.step }
    case 'agent.request':
      return { turn: arg.turn, step: arg.step }
    case 'tools.pre-execute':
    case 'tools.execute':
    case 'tools.post-execute':
      return {
        callId: arg.callId,
        rootCallId: arg.rootCallId,
        name: arg.name,
        arguments: arg.arguments,
      }
    default:
      return arg
  }
}

/** 只保留 agent error/request-error payload 的可序列化字段。 */
function pickAgentPayload(payload: any): unknown {
  if (!payload) return undefined
  return {
    turn: payload.turn,
    step: payload.step,
    provider: payload.provider,
    error: payload.error instanceof Error ? payload.error.message : String(payload.error ?? ''),
  }
}

/** 按事件类型提取关键字段，丢弃 replayState 等大对象。 */
function pickSessionData(type: string | undefined, data: any): unknown {
  if (!data) return undefined
  switch (type) {
    case 'turn/start':
    case 'turn/end':
      return { turn: data.turn }
    case 'step/start':
    case 'step/end':
      return { turn: data.turn, step: data.step }
    case 'assistant/message':
      return {
        turn: data.turn,
        step: data.step,
        message: pickMessage(data.message),
        usage: data.usage,
      }
    case 'tool/call':
      return { turn: data.turn, step: data.step, callId: data.callId, name: data.name, arguments: data.arguments }
    case 'tool/result':
      return { turn: data.turn, step: data.step, message: pickMessage(data.message) }
    case 'user/message':
      return { content: data.content, source: data.source }
    default:
      return data
  }
}

/** 只保留 message 的 role/content/source 关键字段。 */
function pickMessage(message: any): unknown {
  if (!message) return undefined
  return {
    role: message.role,
    content: message.content,
    source: message.source ? { kind: message.source.kind, provider: message.source.provider, model: message.source.model, plugin: message.source.plugin } : undefined,
  }
}

/** 无 turn/step 关联时返回 undefined（会话级事件丢弃，避免产生裸 sessionId 伪 trace）。 */
function resolveTraceId(collector: Collector, sessionId: string | undefined, data: any): string | undefined {
  if (sessionId && data?.turn !== undefined && data?.step !== undefined) {
    return `${sessionId}:${data.turn}:${data.step}`
  }
  if (sessionId) {
    const ids = collector.traceIds().filter((id) => id.startsWith(`${sessionId}:`))
    if (ids.length > 0) return ids[ids.length - 1]
  }
  return undefined
}
