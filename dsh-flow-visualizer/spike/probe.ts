import type { Context } from '@deepseek-ai/cordis'

export const name = 'flow-tracer-probe'

function show(label: string, args: unknown[]) {
  console.log(`\n===== ${label} =====`)
  args.forEach((arg, i) => {
    if (typeof arg === 'undefined') return
    if (typeof arg === 'function') {
      console.log(`  [arg${i}] <function next>`)
      return
    }
    // 特殊处理可迭代对象（stream / async iterable）
    if (arg && typeof (arg as any)[Symbol.asyncIterator] === 'function') {
      console.log(`  [arg${i}] <async iterable>`)
      return
    }
    if (arg && typeof (arg as any)[Symbol.iterator] === 'function' && typeof arg !== 'string') {
      console.log(`  [arg${i}] <iterable>`)
      return
    }
    try {
      const json = JSON.stringify(arg)
      const preview = json && json.length > 800 ? json.slice(0, 800) + '...' : json
      console.log(`  [arg${i}] ${preview}`)
    } catch {
      const keys = arg && typeof arg === 'object' ? Object.keys(arg) : []
      console.log(`  [arg${i}] <unserializable ${Object.prototype.toString.call(arg)}> keys=${keys.join(',')}`)
    }
  })
}

function keysOf(arg: unknown): string[] {
  if (arg && typeof arg === 'object') return Object.keys(arg)
  return []
}

export function apply(ctx: Context) {
  // ---- Waterfall 事件：必须调用 next()，否则会短路 ----
  ctx.on('agent/pre-step', async (payload: any, next: any) => {
    show('agent/pre-step', [payload])
    console.log('  [keys]', keysOf(payload).join(', '))
    const result = await next()
    console.log('  [agent/pre-step -> next()] =', JSON.stringify(result)?.slice(0, 300))
    return result
  })

  ctx.on('agent/request', async (payload: any, next: any) => {
    show('agent/request', [payload])
    console.log('  [keys]', keysOf(payload).join(', '))
    const result = await next()
    console.log('  [agent/request -> next()] LlmCallConfig keys =', keysOf(result).join(', '))
    return result
  })

  ctx.on('agent/request-error', async (payload: any, next: any) => {
    show('agent/request-error', [payload])
    console.log('  [keys]', keysOf(payload).join(', '))
    const result = await next()
    console.log('  [agent/request-error -> next()] =', JSON.stringify(result)?.slice(0, 300))
    return result
  })

  ctx.on('llm/stream', (options: any, next: any) => {
    show('llm/stream', [options])
    console.log('  [llm/stream GenerateOptions keys]', keysOf(options).join(', '))
    const stream = next()
    // 包装可迭代流，观测每个 chunk
    const wrapped: AsyncIterable<any> = {
      async *[Symbol.asyncIterator]() {
        let count = 0
        for await (const chunk of stream) {
          count++
          if (count <= 3) {
            console.log('  [llm/stream chunk]', JSON.stringify(chunk)?.slice(0, 300))
          }
          yield chunk
        }
        console.log('  [llm/stream] total chunks =', count)
      },
    }
    return wrapped
  })

  ctx.on('tools/pre-execute', async (exec: any, next: any) => {
    show('tools/pre-execute', [exec])
    console.log('  [keys]', keysOf(exec).join(', '))
    const result = await next()
    console.log('  [tools/pre-execute -> next()] =', JSON.stringify(result)?.slice(0, 300))
    return result
  })

  ctx.on('tools/execute', async (exec: any, next: any) => {
    show('tools/execute', [exec])
    console.log('  [keys]', keysOf(exec).join(', '))
    console.log('  [callId?]', JSON.stringify(exec?.callId ?? exec?.id ?? null))
    const result = await next()
    console.log('  [tools/execute -> next()] ToolExecutionResult keys =', keysOf(result).join(', '))
    return result
  })

  ctx.on('tools/post-execute', async (exec: any, result: any, next: any) => {
    show('tools/post-execute', [exec, result])
    console.log('  [exec keys]', keysOf(exec).join(', '))
    console.log('  [result keys]', keysOf(result).join(', '))
    const decision = await next()
    console.log('  [tools/post-execute -> next()] =', JSON.stringify(decision)?.slice(0, 300))
    return decision
  })

  // ---- emit 事件：只观察，返回值被忽略 ----
  ctx.on('tools/result', (exec: any, result: any) => {
    show('tools/result', [exec, result])
    console.log('  [exec keys]', keysOf(exec).join(', '))
    console.log('  [result keys]', keysOf(result).join(', '))
    console.log('  [callId?]', JSON.stringify(exec?.callId ?? exec?.id ?? null))
  })

  ctx.on('agent/error', (payload: any) => {
    show('agent/error', [payload])
    console.log('  [keys]', keysOf(payload).join(', '))
  })

  ctx.on('agent/turn-stopping', (payload: any) => {
    show('agent/turn-stopping', [payload])
    console.log('  [keys]', keysOf(payload).join(', '))
  })

  ctx.on('session/event', (session: any, event: any) => {
    // 高频，只打印 tool/call、tool/result 和 step 边界
    const type = event?.type ?? event?.data?.type ?? ''
    if (
      type === 'tool/call' ||
      type === 'tool/result' ||
      type === 'step/start' ||
      type === 'step/end' ||
      type === 'turn/start' ||
      type === 'turn/end' ||
      type === 'assistant/message' ||
      type === 'user/message'
    ) {
      show(`session/event (${type})`, [session, event])
      console.log('  [event keys]', keysOf(event).join(', '))
      console.log('  [data keys]', keysOf(event?.data).join(', '))
    }
  })

  console.log('[flow-tracer-probe] loaded')
}
