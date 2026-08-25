import type { Context } from '@deepseek-ai/cordis'
import { Collector, resolveConfig } from './collector.ts'
import { Emitter } from './emitter.ts'
import { registerHooks } from './hooks.ts'
import { createSanitizer } from './sanitizer.ts'
import { listPlugins } from './plugins.ts'
import { findDshRoot, scanInstalledTools } from './toolmap.ts'
import { registerFlowCommand } from './commands.ts'
import type { FlowConfig } from './types.ts'

export const name = 'dsh-plugin-flow-tracer'
export const inject = ['loader']

export { Collector } from './collector.ts'
export { Emitter } from './emitter.ts'
export type { FlowConfig, FlowEvent, FlowPhase, FlowTrace, SseMessageType } from './types.ts'

export function apply(ctx: Context, config: FlowConfig = {}): void {
  const opts = resolveConfig(config)
  if (!opts.enabled) return

  // 启动后异步扫描已安装插件包，补全 工具→包名 映射（不阻塞启动；用户配置优先，扫描结果覆盖内置表）
  setImmediate(() => {
    const root = findDshRoot()
    if (!root) return
    const scanned = scanInstalledTools(root)
    const userKeys = new Set(Object.keys(config.toolToPlugin ?? {}))
    for (const [tool, pkg] of Object.entries(scanned)) {
      if (!userKeys.has(tool)) opts.toolToPlugin[tool] = pkg
    }
    console.log(`[flow-tracer] scanned ${Object.keys(scanned).length} tool→plugin mappings from installed packages`)
  })

  const sanitize = createSanitizer(opts)
  const collector = new Collector(opts, sanitize)
  const emitter = new Emitter(opts, collector)
  emitter.setPluginProvider(() => listPlugins(ctx))

  registerHooks(ctx, collector, emitter)
  emitter.start()

  // /flow 命令：commands 服务可选（缺失时插件其余功能不受影响）
  const anyCtx = ctx as any
  if (typeof anyCtx.inject === 'function') {
    anyCtx.inject(['commands'], (c: any) => registerFlowCommand(c, collector))
  } else if (anyCtx.commands) {
    registerFlowCommand(anyCtx, collector)
  }

  ctx.effect(
    () => async () => {
      await emitter.close()
    },
    'dsh-plugin-flow-tracer',
  )
}

export default apply
