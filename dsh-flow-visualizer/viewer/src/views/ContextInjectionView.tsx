import { useMemo } from 'react'
import { Card, Group, Stack, Text, Badge } from '@mantine/core'
import { getSessionEvents, useViewerStore } from '../store'
import type { FlowEvent } from '../types'

interface Injection {
  plugin: string
  kind: string
  text: string
  turn: string
  step: string
  ev: FlowEvent
}

/** 从会话事件里提取"插件往上下文注入的内容"。 */
function extractInjections(events: Array<{ ev: FlowEvent; turn: string; step: string }>): Injection[] {
  const result: Injection[] = []
  for (const { ev, turn, step } of events) {
    if (ev.phase !== 'session.event') continue
    const input = ev.input as any
    if (!input || input.type !== 'user/message') continue
    const data = input.data
    const source = data?.source
    if (!source) continue
    const isUser = source.kind === 'user' && !source.plugin
    if (isUser) {
      // 用户消息也算一次注入（起点）
      const text = extractText(data?.content)
      result.push({ plugin: 'user', kind: '用户消息', text, turn, step, ev })
      continue
    }
    const plugin = source.plugin ?? source.kind ?? 'unknown'
    const text = extractText(data?.content)
    result.push({ plugin, kind: '上下文注入', text, turn, step, ev })
  }
  return result
}

function extractText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((block: any) => {
        if (block?.type === 'text' && typeof block.text === 'string') return block.text
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }
  if (typeof content === 'string') return content
  return ''
}

export function ContextInjectionView() {
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)

  const injections = useMemo(() => {
    const ses = currentSessionId ? sessions.get(currentSessionId) : undefined
    if (!ses) return []
    const events = getSessionEvents({ currentSessionId, sessions } as any)
    return extractInjections(events)
  }, [currentSessionId, sessions])

  if (injections.length === 0) {
    return <Text c="dimmed" ta="center" py="xl">暂无上下文注入记录，去 DSH 发条消息吧</Text>
  }

  return (
    <Stack gap="xs">
      {injections.map((inj, i) => (
        <Card key={i} withBorder padding="sm" radius="md">
          <Group gap="xs" mb={4}>
            <Badge variant="light" color={inj.plugin === 'user' ? 'gray' : 'violet'} styles={{ label: { fontFamily: 'monospace' } }}>
              {inj.plugin}
            </Badge>
            <Text size="xs" c="dimmed">{inj.kind}</Text>
            {inj.turn && (
              <Text size="xs" c="dimmed" style={{ marginLeft: 'auto' }}>
                Turn {inj.turn}
                {inj.step ? ` · Step ${inj.step}` : ''}
              </Text>
            )}
          </Group>
          {inj.text && (
            <Text size="xs" c="gray" lineClamp={6} style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
              {inj.text.length > 300 ? inj.text.slice(0, 300) + '…' : inj.text}
            </Text>
          )}
        </Card>
      ))}
    </Stack>
  )
}
