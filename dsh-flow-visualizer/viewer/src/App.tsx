import { useMemo, useState } from 'react'
import {
  Badge,
  Button,
  Group,
  Indicator,
  MantineProvider,
  Modal,
  Select,
  Tabs,
  Text,
} from '@mantine/core'
import '@mantine/core/styles.css'
import { useEventStream } from './useEventStream'
import { getSessionEvents, useViewerStore } from './store'
import { Panel } from './components/Panel'
import { UserInputView } from './views/UserInputView'
import { TimelineView } from './views/TimelineView'
import { EventBusView } from './views/EventBusView'
import { PluginTreeView } from './views/PluginTreeView'
import { PluginsView } from './views/PluginsView'
import { PluginActivityView } from './views/PluginActivityView'
import { fmtDuration } from './format'

function useSessionStats() {
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)

  return useMemo(() => {
    if (!currentSessionId || !sessions.get(currentSessionId)) return null
    const events = getSessionEvents({ currentSessionId, sessions } as any)
    let tools = 0
    let min = Infinity
    let max = -Infinity
    let running = false
    let failed = false
    for (const { ev } of events) {
      if (ev.phase === 'tools.execute') tools++
      if (ev.timestamp < min) min = ev.timestamp
      const end = ev.timestamp + (ev.duration ?? 0)
      if (end > max) max = end
      if (ev.status === 'running') running = true
      if (ev.status === 'error') failed = true
    }
    return {
      count: events.length,
      tools,
      duration: max > 0 && min < Infinity ? max - min : null,
      status: failed ? ('failed' as const) : running ? ('running' as const) : events.length > 0 ? ('completed' as const) : ('idle' as const),
    }
  }, [currentSessionId, sessions])
}

function Header() {
  const connected = useViewerStore((s) => s.connected)
  const sessions = useViewerStore((s) => s.sessions)
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const selectSession = useViewerStore((s) => s.selectSession)
  const stats = useSessionStats()
  const [pluginsOpen, setPluginsOpen] = useState(false)
  const [activityOpen, setActivityOpen] = useState(false)

  const sessionOptions = [...sessions.keys()].map((id) => ({ value: id, label: id }))
  const statusColor =
    stats?.status === 'completed' ? 'teal' : stats?.status === 'failed' ? 'red' : stats?.status === 'running' ? 'yellow' : 'gray'

  return (
    <>
      <header
        style={{
          height: 52,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          padding: '0 16px',
          borderBottom: '1px solid var(--mantine-color-dark-5)',
          background: 'var(--mantine-color-dark-7)',
        }}
      >
        <Group gap={8} wrap="nowrap" style={{ flexShrink: 0 }}>
          <Text fw={700} size="sm">
            DSH Flow Viewer
          </Text>
          <Indicator color={connected ? 'teal' : 'red'} size={7} processing={!connected} offset={2}>
            <Badge variant="light" color={connected ? 'teal' : 'red'} size="xs">
              {connected ? '已连接' : '未连接'}
            </Badge>
          </Indicator>
        </Group>

        <Select
          size="xs"
          placeholder="选择会话"
          data={sessionOptions}
          value={currentSessionId ?? undefined}
          onChange={(v) => v && selectSession(v)}
          clearable
          searchable
          style={{ width: 300 }}
          styles={{ input: { fontFamily: 'monospace', fontSize: 12 } }}
        />

        <Group gap="md" wrap="nowrap" style={{ marginLeft: 'auto', flexShrink: 0 }}>
          {stats && (
            <>
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                事件 <Text span fw={600} c="white">{stats.count}</Text>
              </Text>
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                工具 <Text span fw={600} c="white">{stats.tools}</Text>
              </Text>
              <Text size="xs" c="dimmed" style={{ whiteSpace: 'nowrap' }}>
                耗时 <Text span fw={600} c="white">{fmtDuration(stats.duration)}</Text>
              </Text>
              <Badge variant="light" color={statusColor} size="xs">
                {stats.status}
              </Badge>
            </>
          )}
          <Button variant="light" size="xs" onClick={() => setActivityOpen(true)}>
            调度序列
          </Button>
          <Button variant="light" size="xs" onClick={() => setPluginsOpen(true)}>
            插件清单
          </Button>
        </Group>
      </header>

      <Modal opened={pluginsOpen} onClose={() => setPluginsOpen(false)} title="插件清单" size="lg">
        <PluginsView />
      </Modal>
      <Modal opened={activityOpen} onClose={() => setActivityOpen(false)} title="插件调度序列" size="md">
        <PluginActivityView />
      </Modal>
    </>
  )
}

export default function App() {
  useEventStream()
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)
  const [tab, setTab] = useState<string | null>('bus')

  const eventCount = useMemo(() => {
    if (!currentSessionId) return 0
    return getSessionEvents({ currentSessionId, sessions } as any).length
  }, [currentSessionId, sessions])

  return (
    <MantineProvider defaultColorScheme="dark">
      <div
        style={{
          height: '100vh',
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--mantine-color-dark-8)',
          overflow: 'hidden',
        }}
      >
        <Header />

        <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 12, padding: 12 }}>
          {/* 左栏：会话叙事线 */}
          <div style={{ width: 400, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 12, minWidth: 0 }}>
            <Panel
              title="用户输入"
              subtitle="用户消息与插件注入的上下文"
              rootStyle={{ flex: '0 0 auto', maxHeight: '42%' }}
            >
              <UserInputView />
            </Panel>
            <Panel
              title="事件明细"
              subtitle={`${eventCount} 个事件`}
              rootStyle={{ flex: 1 }}
              bodyStyle={{ padding: 12 }}
            >
              <TimelineView />
            </Panel>
          </div>

          {/* 右侧：可视化画布 */}
          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
            <Tabs
              value={tab}
              onChange={setTab}
              style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}
            >
              <Tabs.List gap={4}>
                <Tabs.Tab value="bus">Cordis 总线</Tabs.Tab>
                <Tabs.Tab value="tree">Cordis 插件树</Tabs.Tab>
              </Tabs.List>

              <Tabs.Panel
                value="bus"
                style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 10 }}
              >
                <Panel title="Cordis 总线" subtitle="触发者 → 事件 → 监听者，插件执行时序" rootStyle={{ flex: 1 }}>
                  <EventBusView />
                </Panel>
              </Tabs.Panel>

              <Tabs.Panel
                value="tree"
                style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column', paddingTop: 10 }}
              >
                <Panel
                  title="Cordis 插件树"
                  subtitle="DSH 客户端插件结构与依赖（绿圈 = 参与本次对话）"
                  rootStyle={{ flex: 1 }}
                >
                  <PluginTreeView />
                </Panel>
              </Tabs.Panel>
            </Tabs>
          </div>
        </div>
      </div>
    </MantineProvider>
  )
}
