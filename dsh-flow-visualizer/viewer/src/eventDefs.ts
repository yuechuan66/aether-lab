// DSH 核心事件定义表（静态，来自源码 @mode 注释，2026-08-25 核实）
// 事件名 ↔ 分发模式 ↔ 触发者 ↔ 说明

export type DispatchMode = 'emit' | 'waterfall' | 'parallel' | 'serial' | 'bail'

export interface EventDef {
  /** Cordis 事件名（namespace/action） */
  event: string
  /** 我们采集用的 phase 名 */
  phase: string
  /** 分发模式 */
  mode: DispatchMode
  /** 触发者（哪个插件/服务 emit） */
  producer: string
  /** 注册者（声明/拥有该事件契约的包；Cordis 事件是字符串，运行时无注册信息，静态维护） */
  owner: string
  /** 说明 */
  desc: string
}

export const EVENT_DEFS: EventDef[] = [
  { event: 'session/created', phase: 'session.created', mode: 'emit', producer: 'session', owner: '@deepseek-ai/dsh-session', desc: '会话创建' },
  { event: 'session/event', phase: 'session.event', mode: 'emit', producer: 'session', owner: '@deepseek-ai/dsh-session', desc: '会话追加记录（firehose）' },
  { event: 'session/flush', phase: 'session.flush', mode: 'parallel', producer: 'session', owner: '@deepseek-ai/dsh-session', desc: '会话落盘检查点' },
  { event: 'session/disposed', phase: 'session.disposed', mode: 'emit', producer: 'session', owner: '@deepseek-ai/dsh-session', desc: '会话销毁' },
  { event: 'agent/pre-step', phase: 'agent.pre-step', mode: 'waterfall', producer: 'agent-loop', owner: '@deepseek-ai/dsh-agent-loop', desc: '步骤开始（可注入消息）' },
  { event: 'agent/request', phase: 'agent.request', mode: 'waterfall', producer: 'agent-loop', owner: '@deepseek-ai/dsh-agent-loop', desc: '模型请求（可替换配置）' },
  { event: 'agent/request-error', phase: 'agent.request-error', mode: 'waterfall', producer: 'agent-loop', owner: '@deepseek-ai/dsh-agent-loop', desc: '请求失败（可重试）' },
  { event: 'agent/turn-stopping', phase: 'agent.turn-stopping', mode: 'serial', producer: 'agent-loop', owner: '@deepseek-ai/dsh-agent-loop', desc: '回合停止边界' },
  { event: 'agent/error', phase: 'agent.error', mode: 'emit', producer: 'agent-loop', owner: '@deepseek-ai/dsh-agent-loop', desc: '步骤/回合错误通知' },
  { event: 'llm/stream', phase: 'llm.stream', mode: 'waterfall', producer: 'llm', owner: '@deepseek-ai/dsh-llm', desc: '模型流式生成（可包装流）' },
  { event: 'tools/pre-execute', phase: 'tools.pre-execute', mode: 'waterfall', producer: '门控（allow/deny/ask）', owner: '@deepseek-ai/dsh-tools', desc: '工具执行门控' },
  { event: 'tools/execute', phase: 'tools.execute', mode: 'waterfall', producer: 'tools', owner: '@deepseek-ai/dsh-tools', desc: '工具执行（超时/重试/指标）' },
  { event: 'tools/post-execute', phase: 'tools.post-execute', mode: 'waterfall', producer: 'tools', owner: '@deepseek-ai/dsh-tools', desc: '工具结果后处理' },
  { event: 'tools/result', phase: 'tools.result', mode: 'emit', producer: 'tools', owner: '@deepseek-ai/dsh-tools', desc: '工具最终结果（只读观测）' },
  { event: 'tools/change', phase: 'tools.change', mode: 'emit', producer: 'tools', owner: '@deepseek-ai/dsh-tools', desc: '工具注册表变更' },
]

export const MODE_COLORS: Record<DispatchMode, string> = {
  emit: '#868e96',
  waterfall: '#4f8cff',
  parallel: '#22c3a6',
  serial: '#e6b84c',
  bail: '#ff922b',
}

export const MODE_LABEL: Record<DispatchMode, string> = {
  emit: '广播 emit',
  waterfall: '链式 waterfall',
  parallel: '并发 parallel',
  serial: '顺序 serial',
  bail: '短路 bail',
}

export function eventDefByPhase(phase: string): EventDef | undefined {
  return EVENT_DEFS.find((d) => d.phase === phase)
}
