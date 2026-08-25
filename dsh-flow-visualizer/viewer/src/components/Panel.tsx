import type { CSSProperties, ReactNode } from 'react'
import { Box, Group, Text } from '@mantine/core'

interface PanelProps {
  title: string
  subtitle?: ReactNode
  actions?: ReactNode
  children: ReactNode
  /** 根节点样式（flex 布局控制等） */
  rootStyle?: CSSProperties
  /** 内容区样式 */
  bodyStyle?: CSSProperties
}

/** 统一面板容器：标题栏 + 可滚动内容区。 */
export function Panel({ title, subtitle, actions, children, rootStyle, bodyStyle }: PanelProps) {
  return (
    <Box
      style={{
        display: 'flex',
        flexDirection: 'column',
        minWidth: 0,
        minHeight: 0,
        border: '1px solid var(--mantine-color-dark-5)',
        borderRadius: 10,
        background: 'var(--mantine-color-dark-7)',
        overflow: 'hidden',
        ...rootStyle,
      }}
    >
      <Group
        gap="xs"
        px="sm"
        py={7}
        justify="space-between"
        wrap="nowrap"
        style={{ borderBottom: '1px solid var(--mantine-color-dark-5)', flexShrink: 0 }}
      >
        <Group gap={8} wrap="nowrap" style={{ minWidth: 0 }}>
          <Text size="xs" fw={700} tt="uppercase" lts={0.6} c="gray.5" style={{ whiteSpace: 'nowrap' }}>
            {title}
          </Text>
          {subtitle && (
            <Text size="xs" c="dimmed" truncate>
              {subtitle}
            </Text>
          )}
        </Group>
        {actions && (
          <Group gap={6} wrap="nowrap" style={{ flexShrink: 0 }}>
            {actions}
          </Group>
        )}
      </Group>
      <Box style={{ flex: 1, minHeight: 0, overflow: 'auto', ...bodyStyle }}>{children}</Box>
    </Box>
  )
}
