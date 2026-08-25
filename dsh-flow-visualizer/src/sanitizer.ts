import type { ResolvedConfig } from './collector.ts'

const MASK = '***'
const MAX_DEPTH = 10

export function sanitize(value: unknown, fields: string[], depth = 0): unknown {
  if (depth > MAX_DEPTH || value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) {
    const out: unknown[] = []
    for (let i = 0; i < value.length && i < 100; i++) {
      out.push(sanitize(value[i], fields, depth + 1))
    }
    return out
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {}
    let count = 0
    for (const [key, val] of Object.entries(value)) {
      if (count++ > 50) break
      const lower = key.toLowerCase()
      const hit = fields.some((f) => lower === f.toLowerCase() || lower.includes(f.toLowerCase()))
      out[key] = hit ? MASK : sanitize(val, fields, depth + 1)
    }
    return out
  }
  return String(value)
}

export function createSanitizer(opts: ResolvedConfig) {
  const fields = opts.sensitiveFields
  return (value: unknown) => sanitize(value, fields)
}
