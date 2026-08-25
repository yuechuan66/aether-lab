export function fmtTime(ts: number | null | undefined): string {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n: number, w: number) => String(n).padStart(w, '0')
  return `${p(d.getHours(), 2)}:${p(d.getMinutes(), 2)}:${p(d.getSeconds(), 2)}.${p(d.getMilliseconds(), 3)}`
}

export function fmtDuration(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return ''
  if (ms < 1000) return `${Math.round(ms)}ms`
  return `${(ms / 1000).toFixed(2)}s`
}

export function phaseClass(phase: string): string {
  if (phase.startsWith('tools.')) return 'tool'
  if (phase.includes('error')) return 'err'
  return ''
}

export function isUnmappedTool(phase: string, pluginName: string): boolean {
  if (!phase.startsWith('tools.')) return false
  if (!pluginName) return false
  return !pluginName.includes('@') && !pluginName.includes('/')
}
