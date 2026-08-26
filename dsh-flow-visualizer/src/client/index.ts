import { FlowTab } from './flow-tab.tsx'

export const name = 'dsh-plugin-flow-tracer-client'
export const inject = ['slots']

/** 客户端插件：在会话页注册「数据流」tab（与「轨迹」平级）。 */
export function apply(ctx: any): void {
  const register = () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'flow',
        order: 20,
        label: () => '数据流',
      },
      FlowTab,
    )
  if (typeof ctx.slots?.inject === 'function') {
    ctx.slots.inject('conversation.view', register)
  } else if (ctx.slots) {
    register()
  }
}
