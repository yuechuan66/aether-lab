import type { Collector } from './collector.ts'
import type { FlowTrace } from './types.ts'

function fmtTime(ts: number): string {
  const d = new Date(ts)
  const p = (n: number, w: number) => String(n).padStart(w, '0')
  return `${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}.${p(d.getMilliseconds(), 3)}`
}

function fmtDuration(ms: number | null): string {
  if (ms == null) return '  -  '
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`
}

function pad(s: string, n: number): string {
  return s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n)
}

function formatTimeline(traces: FlowTrace[]): string {
  const lines: string[] = []
  for (const t of traces) {
    const [, turn, step] = t.traceId.split(':')
    lines.push(
      `▸ Turn ${turn} · Step ${step} — ${fmtDuration(t.totalDuration)} · ${t.status} · ${t.events.length} events`,
    )
    for (const ev of t.events) {
      lines.push(
        `  ${fmtTime(ev.timestamp)}  ${pad(ev.phase, 20)} ${pad(ev.pluginName || '-', 32)} ${pad(fmtDuration(ev.duration), 8)} ${ev.status}`,
      )
    }
    lines.push('')
  }
  return lines.join('\n').trimEnd()
}

/** 注册 /flow 命令：终端直出当前会话数据流；--json 输出原始 trace。 */
export function registerFlowCommand(ctx: { commands?: any }, collector: Collector): void {
  const registry = ctx.commands
  if (!registry || typeof registry.register !== 'function') return
  registry.register({
    name: 'flow',
    description: 'show this session’s plugin/event flow (append --json for raw traces)',
    input: { hint: '[--json]' },
    recordInput: false,
    handler: (invocation: any) => {
      const sessionId = invocation?.agent?.session?.id as string | undefined
      if (!sessionId) return { kind: 'error', text: 'flow: no active session' }
      const traces = collector
        .traceIds()
        .filter((id) => id.startsWith(`${sessionId}:`))
        .map((id) => collector.getTrace(id))
        .filter((t): t is FlowTrace => !!t)
      if (traces.length === 0) {
        return { kind: 'success', text: 'flow: no data for this session yet — send a message first.' }
      }
      if (/--json/.test(invocation?.rawInput ?? '')) {
        return { kind: 'success', text: JSON.stringify(traces, null, 2) }
      }
      return { kind: 'success', text: formatTimeline(traces) }
    },
  })
}
