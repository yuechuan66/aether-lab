import type { Context } from '@deepseek-ai/cordis'

export interface PluginNode {
  id: string
  name: string
  enabled: boolean
  phase: string
  /** fiber.inject 的服务名列表（消费者依赖，出边） */
  inject: string[]
  /** fiber.store 的服务名列表（提供的服务，入边） */
  provides: string[]
  /** 是否 group（折叠组） */
  group: boolean
  /** isolate realm 归属（true=entry-local，string=共享 realm 名） */
  isolate: string | null
}

/** 一次遍历 loader.entries() 重建完整插件树：结构 + 依赖边 + group/isolate。 */
export function listPlugins(ctx: Context): PluginNode[] {
  const loader = ctx.get('loader') as any
  if (!loader || typeof loader.entries !== 'function') return []

  const result: PluginNode[] = []
  const phaseMap: Record<number, string> = {
    0: 'pending',
    1: 'loading',
    2: 'active',
    3: 'failed',
    4: 'disposed',
    5: 'unloading',
  }

  for (const entry of loader.entries()) {
    const id = entry?.options?.id ?? ''
    const name = entry?.options?.name ?? ''
    const fiber = entry?.fiber

    // fiber.inject：消费者依赖（服务名 → 值）
    const inject: string[] = []
    if (fiber?.inject && typeof fiber.inject === 'object') {
      for (const k of Object.keys(fiber.inject)) inject.push(k)
    }

    // fiber.store：提供的服务（服务名 → Impl）
    const provides: string[] = []
    if (fiber?.store && typeof fiber.store === 'object') {
      for (const k of Object.keys(fiber.store)) provides.push(k)
    }

    // group 标记：entry.options.group（布尔）
    const group = !!entry?.options?.group

    // isolate：entry.options.isolate（true | string）
    const isolateRaw = entry?.options?.isolate
    const isolate = typeof isolateRaw === 'string' ? isolateRaw : isolateRaw === true ? '<local>' : null

    result.push({
      id,
      name,
      enabled: !entry?.disabled,
      phase: phaseMap[fiber?.state] ?? 'unknown',
      inject,
      provides,
      group,
      isolate,
    })
  }

  return result
}
