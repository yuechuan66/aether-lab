import { useMemo, useState } from 'react'
import { Badge, Box, Collapse, Group, Stack, Text, UnstyledButton } from '@mantine/core'
import { getSessionEvents, useViewerStore } from '../store'
import { fmtTime } from '../format'

interface Message {
  plugin: string
  text: string
  turn: string
  step: string
  time: number
}

function extractText(content: unknown): string {
  if (Array.isArray(content)) {
    return content
      .map((block: any) => (block?.type === 'text' && typeof block.text === 'string' ? block.text : ''))
      .filter(Boolean)
      .join('\n')
  }
  if (typeof content === 'string') return content
  return ''
}

/** 用户输入（突出显示）+ 插件上下文注入（折叠区）。 */
export function UserInputView() {
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)
  const [showInjections, setShowInjections] = useState(false)

  const { userMsgs, injections } = useMemo(() => {
    const userMsgs: Message[] = []
    const injections: Message[] = []
    for (const { ev, turn, step } of getSessionEvents({ currentSessionId, sessions } as any)) {
      if (ev.phase !== 'session.event') continue
      const input = ev.input as any
      if (input?.type !== 'user/message') continue
      const source = input.data?.source
      if (!source) continue
      const msg: Message = {
        plugin: source.kind === 'user' && !source.plugin ? 'user' : (source.plugin ?? source.kind ?? 'unknown'),
        text: extractText(input.data?.content),
        turn,
        step,
        time: ev.timestamp,
      }
      if (source.kind === 'user' && !source.plugin) userMsgs.push(msg)
      else injections.push(msg)
    }
    return { userMsgs, injections }
  }, [currentSessionId, sessions])

  if (userMsgs.length === 0 && injections.length === 0) {
    return (
      <Text c="dimmed" size="xs" ta="center" py="xl">
        暂无用户输入，去 DSH 发条消息吧
      </Text>
    )
  }

  return (
    <Stack gap={10} p={12}>
      {[...userMsgs].sort((a, b) => b.time - a.time).map((m, i) => (
        <Box
          key={i}
          p="sm"
          style={{
            borderLeft: '3px solid var(--mantine-color-blue-5)',
            background: 'rgba(79,140,255,0.07)',
            borderRadius: 8,
          }}
        >
          <Group gap={6} mb={6} wrap="nowrap">
            <Badge size="xs" variant="light" color="blue">
              Turn {m.turn}
            </Badge>
            <Text size="xs" c="dimmed" style={{ marginLeft: 'auto', flexShrink: 0 }}>
              {fmtTime(m.time)}
            </Text>
          </Group>
          <Text size="sm" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
            {m.text || '(空消息)'}
          </Text>
        </Box>
      ))}

      {injections.length > 0 && (
        <Box>
          <UnstyledButton onClick={() => setShowInjections((v) => !v)} style={{ display: 'block' }}>
            <Group gap={6}>
              <Text size="xs" c="violet.4" fw={600}>
                {showInjections ? '▾' : '▸'} 插件注入的上下文（{injections.length}）
              </Text>
            </Group>
          </UnstyledButton>
          <Collapse in={showInjections}>
            <Stack gap={6} mt={6}>
              {injections.map((m, i) => (
                <Box key={i} p={8} style={{ background: 'var(--mantine-color-dark-6)', borderRadius: 6 }}>
                  <Group gap={6} mb={4} wrap="nowrap">
                    <Badge size="xs" variant="light" color="violet" styles={{ label: { fontFamily: 'monospace' } }}>
                      {m.plugin}
                    </Badge>
                    <Text size="xs" c="dimmed" style={{ marginLeft: 'auto', flexShrink: 0 }}>
                      Turn {m.turn} · {fmtTime(m.time)}
                    </Text>
                  </Group>
                  <Text size="xs" c="gray.5" lineClamp={4} style={{ whiteSpace: 'pre-wrap', fontFamily: 'monospace' }}>
                    {m.text.length > 400 ? m.text.slice(0, 400) + '…' : m.text}
                  </Text>
                </Box>
              ))}
            </Stack>
          </Collapse>
        </Box>
      )}
    </Stack>
  )
}
