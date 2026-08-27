import type { FlowStepState, FlowUserState } from './flow-definitions.ts'

export interface FlowSnapshot {
  steps: FlowStepState[]
  users: FlowUserState[]
}

export const EMPTY_FLOW: FlowSnapshot = { steps: [], users: [] }

/** 「flow」视图目标：把节点物化成 { steps, users } 快照供组件读取。 */
export const flowViewDefinition = {
  target: 'flow',
  create: () => {
    const nodes = new Map<string, any>()

    const materialize = (): FlowSnapshot => {
      const steps: FlowStepState[] = []
      const users: FlowUserState[] = []
      for (const n of nodes.values()) {
        if (n.kind === 'flow-step') steps.push(n.data)
        else if (n.kind === 'flow-user') users.push(n.data)
      }
      steps.sort((a, b) => a.startSeq - b.startSeq)
      users.sort((a, b) => a.seq - b.seq)
      return { steps, users }
    }

    return {
      empty: EMPTY_FLOW,
      replace: (input: { nodes: readonly any[] }) => {
        nodes.clear()
        for (const n of input.nodes) nodes.set(`${n.kind}:${n.id}`, n)
        return materialize()
      },
      apply: (input: { upserts: readonly any[] }) => {
        for (const n of input.upserts) nodes.set(`${n.kind}:${n.id}`, n)
        return materialize()
      },
    }
  },
}
