import { FlowTab } from './flow-tab.tsx'

export const name = 'dsh-plugin-flow-tracer-client'
export const inject = ['slots']

/** 客户端插件：在会话页注册「数据流」tab（原生渲染完整 Viewer）。 */
export function apply(ctx: any): void {
  const registerSlot = () =>
    ctx.slots.register(
      {
        name: 'conversation.view',
        id: 'flow',
        order: 20,
        label: () => '数据流',
        inject: (sessionId: string) => ({ sessionId }),
      },
      FlowTab,
    )
  if (typeof ctx.slots?.inject === 'function') {
    ctx.slots.inject('conversation.view', registerSlot)
  } else if (ctx.slots) {
    registerSlot()
  }
}
