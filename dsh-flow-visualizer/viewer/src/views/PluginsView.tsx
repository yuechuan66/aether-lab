import { useEffect, useState } from 'react'
import { Badge, Card, Stack, Table, Text, Alert } from '@mantine/core'
import type { PluginNode } from '../types'

export function PluginsView() {
  const [plugins, setPlugins] = useState<PluginNode[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/plugins')
      .then((r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((data) => setPlugins(data.plugins ?? []))
      .catch((e) => setError(String(e)))
  }, [])

  if (error) {
    return <Alert color="red" title="加载插件清单失败">{error}</Alert>
  }

  if (plugins.length === 0) {
    return <Text c="dimmed" ta="center" py="xl">未获取到插件清单</Text>
  }

  const phaseColor = (phase: string) => {
    switch (phase) {
      case 'active': return 'teal'
      case 'failed': return 'red'
      case 'loading': return 'yellow'
      case 'pending': return 'gray'
      case 'unloading': return 'orange'
      default: return 'gray'
    }
  }

  return (
    <Stack gap="md">
      <Text size="sm" c="dimmed">
        当前 DSH 客户端已加载的插件清单（来自 Cordis Loader），共 {plugins.length} 个。
      </Text>
      <Card withBorder radius="md" padding="sm">
        <Table striped highlightOnHover fontSize="xs">
          <Table.Thead>
            <Table.Tr>
              <Table.Th>插件</Table.Th>
              <Table.Th>状态</Table.Th>
              <Table.Th>ID</Table.Th>
            </Table.Tr>
          </Table.Thead>
          <Table.Tbody>
            {plugins.map((p, i) => (
              <Table.Tr key={i}>
                <Table.Td>
                  <Text size="xs" style={{ fontFamily: 'monospace' }}>{p.name}</Text>
                </Table.Td>
                <Table.Td>
                  <Badge variant="light" color={phaseColor(p.phase)} size="xs">
                    {p.phase}
                    {p.enabled ? '' : ' · 禁用'}
                  </Badge>
                </Table.Td>
                <Table.Td>
                  <Text size="xs" c="dimmed" style={{ fontFamily: 'monospace' }}>{p.id}</Text>
                </Table.Td>
              </Table.Tr>
            ))}
          </Table.Tbody>
        </Table>
      </Card>
    </Stack>
  )
}
