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
        if (turn !== lastTurn || step !== lastStep) {
          parts.push(
            <div
              key={`ts-${turn}-${step}`}
              style={{ padding: '2px 8px', fontSize: 10, fontWeight: 700, background: 'rgba(148,163,184,0.08)', borderLeft: '3px solid var(--mantine-color-dark-4)', borderRadius: 3, marginTop: 6, display: 'flex', gap: 8 }}
            >
              <span style={{ color: 'var(--mantine-color-teal-6)' }}>Turn {turn}</span>
              <span style={{ color: 'var(--mantine-color-blue-5)' }}>Step {step}</span>
            </div>,
          )
          lastTurn = turn
          lastStep = step
        }

        parts.push(
          <EventCard key={ev.id} ev={ev} />,
        )
        return parts
      })}
    </Stack>
  )
}

function preview(v: unknown, max = 48): string {
  if (v === undefined) return ''
  if (v === null) return 'null'
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  return s.length > max ? s.slice(0, max) + '…' : s
}

function EventCard({ ev }: { ev: { id: string; phase: string; pluginName: string; status: string; timestamp: number; duration: number | null; input: unknown; output: unknown } }) {
  const unmapped = isUnmappedTool(ev.phase, ev.pluginName)
  const dotColor = ev.status === 'success' ? '#12b886' : ev.status === 'error' ? '#fa5252' : ev.status === 'running' ? '#fab005' : '#adb5bd'

  return (
    <Card withBorder padding="xs" radius="md">
      <Group gap={6} wrap="nowrap">
        <Badge
          variant="light"
          size="xs"
          color={phaseClass(ev.phase) === 'tool' ? 'teal' : phaseClass(ev.phase) === 'err' ? 'red' : 'blue'}
          styles={{ label: { fontFamily: 'monospace', fontSize: 9 } }}
        >
          {ev.phase}
        </Badge>
        <Text size={10} lh={1.5} c={unmapped ? 'yellow' : 'dimmed'} truncate style={{ flex: 1, minWidth: 0 }}>
          {ev.pluginName || '-'}
          {unmapped ? ' (未映射)' : ''}
        </Text>
        <span title={ev.status} style={{ width: 6, height: 6, borderRadius: '50%', background: dotColor, flexShrink: 0 }} />
        <Text size={9} lh={1.5} c="dimmed" style={{ flexShrink: 0, fontFamily: 'monospace' }}>{fmtTime(ev.timestamp)}</Text>
        <Text size={9} lh={1.5} c="dimmed" style={{ flexShrink: 0, fontFamily: 'monospace' }}>{fmtDuration(ev.duration)}</Text>
      </Group>

      <Accordion
        variant="contained"
        mt="xs"
        chevronPosition="left"
        styles={{
          label: { fontSize: 11 },
          content: { padding: 6 },
          chevron: { margin: 0 },
          control: { padding: '4px 6px', minHeight: 28 },
        }}
      >
        <Accordion.Item value="input">
          <Accordion.Control>
            <Group gap={6} wrap="nowrap">
              <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>输入</span>
              <Text size={10} lh={1.5} c="dimmed" truncate style={{ fontFamily: 'monospace', flex: 1, minWidth: 0 }}>{preview(ev.input, 80)}</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <pre style={{ fontSize: 9.5, lineHeight: 1.45, background: "var(--mantine-color-dark-6)", padding: 6, borderRadius: 4, overflow: "auto", maxHeight: 260, wordBreak: "break-all" }}>
              {JSON.stringify(ev.input, null, 2) ?? 'null'}
            </pre>
          </Accordion.Panel>
        </Accordion.Item>
        <Accordion.Item value="output">
          <Accordion.Control>
            <Group gap={6} wrap="nowrap">
              <span style={{ whiteSpace: 'nowrap', flexShrink: 0 }}>输出</span>
              <Text size={10} lh={1.5} c="dimmed" truncate style={{ fontFamily: 'monospace', flex: 1, minWidth: 0 }}>{preview(ev.output, 80)}</Text>
            </Group>
          </Accordion.Control>
          <Accordion.Panel>
            <pre style={{ fontSize: 9.5, lineHeight: 1.45, background: "var(--mantine-color-dark-6)", padding: 6, borderRadius: 4, overflow: "auto", maxHeight: 260, wordBreak: "break-all" }}>
              {JSON.stringify(ev.output, null, 2) ?? 'null'}
            </pre>
          </Accordion.Panel>
        </Accordion.Item>
      </Accordion>
    </Card>
  )
}
