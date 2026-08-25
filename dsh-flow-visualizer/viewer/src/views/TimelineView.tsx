import { useMemo } from 'react'
import { Accordion, Badge, Card, Group, Stack, Text } from '@mantine/core'
import { getSessionEvents, useViewerStore } from '../store'
import { fmtDuration, fmtTime, isUnmappedTool, phaseClass } from '../format'

export function TimelineView() {
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)

  const { session, events } = useMemo(() => {
    const ses = currentSessionId ? sessions.get(currentSessionId) : undefined
    return { session: ses, events: getSessionEvents({ currentSessionId, sessions } as any) }
  }, [currentSessionId, sessions])

  if (!session || events.length === 0) {
    return <Text c="dimmed" ta="center" py="xl">暂无事件，去 DSH 发条消息吧</Text>
  }

  let lastTurn: string | null = null
  let lastStep: string | null = null

  return (
    <Stack gap="xs">
      {events.map(({ ev, turn, step }) => {
        const parts: React.ReactNode[] = []
        if (turn !== lastTurn) {
          parts.push(
            <div key={`turn-${turn}`} style={{ padding: '8px 14px', fontSize: 13, fontWeight: 700, color: 'var(--mantine-color-teal-6)', background: 'rgba(18,184,134,0.1)', borderLeft: '4px solid var(--mantine-color-teal-6)', borderRadius: 4, letterSpacing: 1, marginTop: 16 }}>
              Turn {turn}
            </div>,
          )
          lastStep = null
        }
        if (step !== lastStep) {
          parts.push(
            <div key={`step-${turn}-${step}`} style={{ padding: '5px 12px', fontSize: 12, fontWeight: 700, color: 'var(--mantine-color-blue-5)', background: 'rgba(45,112,156,0.08)', borderLeft: '3px solid var(--mantine-color-blue-5)', borderRadius: 4, marginTop: 8 }}>
              Step {step}
            </div>,
          )
        }
        lastTurn = turn
        lastStep = step

        parts.push(
          <EventCard key={ev.id} ev={ev} />,
        )
        return parts
      })}
    </Stack>
  )
}

function EventCard({ ev }: { ev: { id: string; phase: string; pluginName: string; status: string; timestamp: number; duration: number | null; input: unknown; output: unknown } }) {
  const unmapped = isUnmappedTool(ev.phase, ev.pluginName)
  const statusColor = ev.status === 'success' ? 'teal' : ev.status === 'error' ? 'red' : ev.status === 'running' ? 'yellow' : 'gray'

  return (
    <Card withBorder padding="sm" radius="md">
      <Group gap="xs" wrap="wrap">
        <Badge variant="light" color={phaseClass(ev.phase) === 'tool' ? 'teal' : phaseClass(ev.phase) === 'err' ? 'red' : 'blue'} styles={{ label: { fontFamily: 'monospace' } }}>
          {ev.phase}
        </Badge>
        {ev.pluginName ? (
          <Text size="xs" c={unmapped ? 'yellow' : 'dimmed'}>
            {ev.pluginName}{unmapped ? ' (未映射插件)' : ''}
          </Text>
        ) : (
          <Text size="xs" c="dimmed">-</Text>
        )}
        <Badge variant="light" color={statusColor} size="xs">{ev.status}</Badge>
        <Text size="xs" c="dimmed" style={{ marginLeft: 'auto' }}>{fmtTime(ev.timestamp)}</Text>
        <Text size="xs" c="dimmed">{fmtDuration(ev.duration)}</Text>
      </Group>

      <Accordion variant="contained" mt="xs" chevronPosition="left">
        <Accordion.Item value="input">
          <Accordion.Control>输入</Accordion.Control>
          <Accordion.Panel>
            <pre style={{ fontSize: 12, background: 'var(--mantine-color-dark-7)', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 200 }}>
              {JSON.stringify(ev.input, null, 2) ?? 'null'}
            </pre>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="output">
          <Accordion.Control>输出</Accordion.Control>
          <Accordion.Panel>
            <pre style={{ fontSize: 12, background: 'var(--mantine-color-dark-7)', padding: 8, borderRadius: 4, overflow: 'auto', maxHeight: 200 }}>
              {JSON.stringify(ev.output, null, 2) ?? 'null'}
            </pre>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  )
}
