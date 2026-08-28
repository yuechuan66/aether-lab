/**
 * @daf/dsh-server-api — Phase 1 carrier plugin.
 *
 * One shared mux/host subscription (MuxHub) + self-defined /v1 REST/SSE
 * contract over ctx.webServer, driving ctx.apiProxy. External Agent clients
 * never touch the DSH-private /api bridge.
 */
import type { Ctx } from './types.js'
import { MuxHub } from './hub.js'
import { makeHandlers } from './routes.js'

export const name = '@daf/dsh-server-api'
export const inject = ['webServer', 'apiProxy']

export function apply(ctx: Ctx): void {
  const log = (...a: unknown[]) => console.log('[daf-server]', ...a)

  const apiKeys = (process.env.DAF_API_KEYS ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
  if (!apiKeys.length) {
    log('WARNING: DAF_API_KEYS not set — all protected routes will answer 503')
  }

  const hub = new MuxHub(ctx.apiProxy, log)
  hub.start()

  const sessions = new Set<string>()
  const { health, sessionsRoot, sessionsSub } = makeHandlers({
    apiProxy: ctx.apiProxy,
    hub,
    sessions,
    apiKeys,
    log,
  })

  ctx.webServer.register({ kind: 'exact', path: '/v1/health', handler: health })
  ctx.webServer.register({ kind: 'exact', path: '/v1/sessions', handler: sessionsRoot })
  ctx.webServer.register({ kind: 'prefix', path: '/v1/sessions', handler: sessionsSub })

  log(`routes ready (/v1/health, /v1/sessions/*); apiKeys=${apiKeys.length}`)
}
