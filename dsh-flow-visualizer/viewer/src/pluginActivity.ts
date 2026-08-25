import { getSessionEvents } from './store'
import type { FlowEvent, PluginNode } from './types'

export interface PluginActivity {
  name: string
  actions: Set<string>
  injectCount: number
  toolCount: number
  modelCount: number
  firstSeen: number
  order: number
  turn: string
  step: string
}

function actionLabel(ev: FlowEvent): string | null {
  switch (ev.phase) {
    case 'agent.pre-step':
    case 'agent.request':
      return 'agent 循环'
    case 'llm.stream':
      return '模型调用'
    case 'tools.pre-execute':
    case 'tools.execute':
    case 'tools.post-execute':
      return '工具执行'
    case 'tools.result':
      return '工具结果'
    case 'session.event': {
      const t = (ev.input as any)?.type
      if (t === 'user/message') {
        const src = (ev.input as any)?.data?.source
        if (src?.plugin) return '上下文注入'
        if (src?.kind === 'user') return '用户消息'
      }
      if (t === 'assistant/message') return '模型回复'
      return null
    }
    default:
      return null
  }
}

/** 计算本次对话参与过的插件活动。返回按参与顺序排序的列表。 */
export function buildActivities(sessionId: string | null, sessions: Map<string, any>): PluginActivity[] {
  if (!sessionId) return []
  const events = getSessionEvents({ currentSessionId: sessionId, sessions } as any)
  const map = new Map<string, PluginActivity>()

  for (const { ev, turn, step } of events) {
    const label = actionLabel(ev)
    if (!label) continue

    let name = ''
    if (ev.phase.startsWith('agent.')) {
      name = 'agent-loop'
    } else if (ev.phase === 'llm.stream' || label === '模型回复') {
      name = ev.pluginName || 'model'
    } else if (ev.phase.startsWith('tools.')) {
      name = ev.pluginName || 'tool'
    } else if (ev.phase === 'session.event') {
      const t = (ev.input as any)?.type
      if (t === 'user/message') {
        const src = (ev.input as any)?.data?.source
        name = src?.plugin ?? (src?.kind === 'user' ? 'user' : 'unknown')
      }
    }
    if (!name) continue

    let a = map.get(name)
    if (!a) {
      a = { name, actions: new Set(), injectCount: 0, toolCount: 0, modelCount: 0, firstSeen: ev.timestamp, order: map.size + 1, turn, step }
      map.set(name, a)
    }
    a.actions.add(label)
    if (label === '上下文注入') a.injectCount++
    if (label === '工具执行' || label === '工具结果') a.toolCount++
    if (label === '模型调用') a.modelCount++
  }

  return [...map.values()].sort((a, b) => a.firstSeen - b.firstSeen)
}

/** 将活动名解析到插件树节点 id，使绿圈数字与调度序列对应。 */
export function resolveActivityNodeId(a: PluginActivity, plugins: PluginNode[]): string | null {
  // 1. 精确匹配：包名或 entry id（含已映射工具、agent-loop）
  let node = plugins.find((p) => p.name === a.name || p.id === a.name)
  if (node) return node.id

  // 2. 未映射工具名：bash -> tool-bash / dsh-tool-bash
  if (!a.name.includes('/')) {
    node = plugins.find((p) => p.id === `tool-${a.name}` || p.name.includes(`dsh-tool-${a.name}`))
    if (node) return node.id
  }

  // 3. provider/model：模型调用归属 llm 核心节点
  if (a.name.includes('/')) {
    node = plugins.find((p) => p.id === 'llm') ?? plugins.find((p) => p.name === '@deepseek-ai/dsh-llm')
    if (node) return node.id
  }

  // 4. user 等非插件活动不落到树上
  return null
}

/** 只对可落到插件节点的活动编号（1..N），调度序列与插件树共用同一套数字。 */
export function buildPluginNumbering(activities: PluginActivity[], plugins: PluginNode[]) {
  const byActivity = new Map<string, number>()
  const byNode = new Map<string, number>()
  let n = 0
  for (const a of activities) {
    const id = resolveActivityNodeId(a, plugins)
    if (!id) continue
    n++
    byActivity.set(a.name, n)
    if (!byNode.has(id)) byNode.set(id, n)
  }
  return { byActivity, byNode }
}
