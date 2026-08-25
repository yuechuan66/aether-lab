import { useMemo } from 'react'
import { Badge, Card, Group, Stack, Text } from '@mantine/core'
import { useViewerStore } from '../store'
import { buildActivities, buildPluginNumbering } from '../pluginActivity'
import { usePlugins } from '../usePlugins'
import { fmtTime } from '../format'

export function PluginActivityView() {
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)
  const plugins = usePlugins()

  const activities = useMemo(
    () => buildActivities(currentSessionId, sessions),
    [currentSessionId, sessions],
  )

  const numbering = useMemo(
    () => (plugins ? buildPluginNumbering(activities, plugins) : null),
    [activities, plugins],
  )

  if (activities.length === 0) {
    return <Text c="dimmed" ta="center" py="md">暂无插件活动，去 DSH 发条消息吧</Text>
  }

  return (
    <Stack gap="xs">
      {activities.map((a) => {
        const num = numbering?.byActivity.get(a.name)
        return (
        <Card key={a.name} withBorder padding="sm" radius="md">
          <Group gap="xs" mb={4}>
            {num != null ? (
              <Badge variant="filled" color="teal" size="xs" circle>{num}</Badge>
            ) : (
              <Badge variant="light" color="gray" size="xs" circle title="非插件参与者">–</Badge>
            )}
            <Text size="xs" fw={600} style={{ fontFamily: 'monospace', wordBreak: 'break-all' }}>
              {a.name}
            </Text>
            <Text size="xs" c="dimmed" style={{ marginLeft: 'auto' }}>
              {fmtTime(a.firstSeen)}
            </Text>
          </Group>
          <Group gap={4}>
            {[...a.actions].map((act) => (
              <Badge
                key={act}
                variant="light"
                size="xs"
                color={act === '工具执行' || act === '工具结果' ? 'teal' : act === '上下文注入' ? 'violet' : act === '模型调用' || act === '模型回复' ? 'indigo' : 'blue'}
              >
                {act}
              </Badge>
            ))}
            {a.toolCount > 0 && <Text size="xs" c="dimmed">工具×{a.toolCount}</Text>}
            {a.injectCount > 0 && <Text size="xs" c="dimmed">注入×{a.injectCount}</Text>}
            {a.modelCount > 0 && <Text size="xs" c="dimmed">模型×{a.modelCount}</Text>}
          </Group>
        </Card>
        )
      })}
    </Stack>
  )
}
