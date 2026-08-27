import { useEffect, useMemo, useRef, useState } from 'react'
import { ActionIcon, Badge, Box, Group, Stack, Switch, Text, Tooltip } from '@mantine/core'
import ELK from 'elkjs/lib/elk.bundled.js'
import { useViewerStore } from '../store'
import { buildActivities, buildPluginNumbering } from '../pluginActivity'
import { usePlugins } from '../usePlugins'
import type { PluginNode } from '../types'

function categorize(name: string): string {
  if (name.includes('cordis-plugin') || name === 'cordis:include') return '框架'
  if (name.includes('dsh-llm')) return '模型'
  if (name.includes('dsh-session')) return '会话'
  if (name.includes('dsh-agent')) return 'Agent'
  if (name.includes('dsh-tool-') || name.includes('dsh-bash') || name.includes('dsh-pwsh') || name.includes('dsh-fs')) return '工具'
  if (name.includes('dsh-sandbox')) return '沙箱'
  if (name.includes('dsh-skill')) return '技能'
  if (name.includes('dsh-client-ui') || name.includes('dsh-client-')) return 'UI'
  if (name.includes('dsh-host-')) return 'Host'
  if (name.includes('dsh-web') || name.includes('dsh-api')) return 'Web'
  if (name.includes('dsh-command') || name.includes('dsh-goal') || name.includes('dsh-plan') || name.includes('dsh-compaction') || name.includes('dsh-subagent')) return '编排'
  if (name.includes('dsh-code-runtime') || name.includes('dsh-workflow') || name.includes('dsh-jobs') || name.includes('dsh-spill')) return '运行时'
  return '其他'
}

const COLORS: Record<string, string> = {
  '框架': '#7c5cff', '模型': '#4f8cff', '会话': '#22c3a6', 'Agent': '#e6b84c',
  '编排': '#ff5c8a', '工具': '#9aa6bd', '沙箱': '#ff7a59', '技能': '#9775fa',
  '运行时': '#fa5252', 'Web': '#2db8ff', 'Host': '#94d82d', 'UI': '#f06595', '其他': '#868e96',
}

const NODE_W = 190
const NODE_H = 26

interface Edge {
  id: string
  from: string
  to: string
  service: string
}

export function PluginTreeView() {
  const plugins = usePlugins()
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [hideDisabled, setHideDisabled] = useState(false)
  const [hideUI, setHideUI] = useState(true)
  const [hideUnused, setHideUnused] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)
  const [zoom, setZoom] = useState(0.8)
  const containerRef = useRef<HTMLDivElement>(null)
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)

  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && !e.metaKey) return
    e.preventDefault()
    setZoom((z) => Math.min(2, Math.max(0.3, z + (e.deltaY < 0 ? 0.1 : -0.1))))
  }

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen()
  }

  useEffect(() => {
    const onChange = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onChange)
    return () => document.removeEventListener('fullscreenchange', onChange)
  }, [])

  const activities = useMemo(
    () => buildActivities(currentSessionId, sessions),
    [currentSessionId, sessions],
  )

  // 插件级编号：与调度序列共用同一套数字（user 等非插件活动不编号）
  const numbering = useMemo(
    () => (plugins ? buildPluginNumbering(activities, plugins) : null),
    [activities, plugins],
  )
  const activityMap = numbering?.byNode ?? new Map<string, number>()

  const [layout, setLayout] = useState<{
    pos: Map<string, { x: number; y: number }>
    edges: Edge[]
    nodes: string[]
    width: number
    height: number
    nodeById: Map<string, PluginNode>
  } | null>(null)

  // elk 布局：useEffect 触发，避免 render 中异步副作用
  useEffect(() => {
    if (!plugins) return
    let cancelled = false

    let filtered = plugins
    if (hideDisabled) filtered = filtered.filter((p) => p.enabled)
    if (hideUI) filtered = filtered.filter((p) => !p.name.includes('dsh-client-ui') && !p.name.includes('dsh-client-'))

    const nodeById = new Map<string, PluginNode>()
    for (const p of filtered) nodeById.set(p.id, p)

    const providerByService = new Map<string, string>()
    for (const p of filtered) {
      for (const svc of p.provides) if (!providerByService.has(svc)) providerByService.set(svc, p.id)
    }

    const edges: Edge[] = []
    const seen = new Set<string>()
    for (const p of filtered) {
      for (const svc of p.inject) {
        const pid = providerByService.get(svc)
        if (!pid || pid === p.id) continue
        const key = `${p.id}->${pid}`
        if (seen.has(key)) continue
        seen.add(key)
        edges.push({ id: key, from: p.id, to: pid, service: svc })
      }
    }

    let visible = new Set<string>()
    if (hideUnused) {
      for (const e of edges) { visible.add(e.from); visible.add(e.to) }
    } else {
      visible = new Set([...nodeById.keys()])
    }

    const connectedNodes = [...visible].filter((id) => nodeById.has(id))
    const connectedEdges = edges.filter((e) => visible.has(e.from) && visible.has(e.to))

    const elk = new ELK()
    const graph = {
      id: 'root',
      layoutOptions: {
        'elk.algorithm': 'layered',
        'elk.direction': 'RIGHT',
        'elk.spacing.nodeNode': '12',
        'elk.layered.spacing.nodeNodeBetweenLayers': '60',
        'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
        'elk.edgeRouting': 'ORTHOGONAL',
      },
      children: connectedNodes.map((id) => ({ id, width: NODE_W, height: NODE_H })),
      edges: connectedEdges.map((e) => ({ id: e.id, sources: [e.from], targets: [e.to] })),
    }

    elk.layout(graph).then((l) => {
      if (cancelled) return
      const pos = new Map<string, { x: number; y: number }>()
      for (const n of l.children ?? []) pos.set(n.id, { x: n.x ?? 0, y: n.y ?? 0 })
      setLayout({
        pos,
        edges: connectedEdges,
        nodes: connectedNodes,
        width: l.width ?? 0,
        height: l.height ?? 0,
        nodeById,
      })
    })

    return () => { cancelled = true }
  }, [plugins, hideDisabled, hideUI, hideUnused])

  // hover 邻接集（必须在任何提前 return 之前，保持 hook 数量稳定）
  const hoverAdj = useMemo(() => {
    const s = new Set<string>()
    if (!hoverId || !layout) return s
    s.add(hoverId)
    for (const e of layout.edges) {
      if (e.from === hoverId) s.add(e.to)
      if (e.to === hoverId) s.add(e.from)
    }
    return s
  }, [hoverId, layout])

  if (!layout) {
    return <Text c="dimmed" ta="center" py="md">依赖图布局中…</Text>
  }

  const { pos, edges, nodes, width, height, nodeById } = layout

  const selectedNode = selectedId ? nodeById.get(selectedId) : undefined

  return (
    <Box ref={containerRef} p={12} style={{ background: isFullscreen ? 'var(--mantine-color-dark-8)' : undefined, overflowY: isFullscreen ? 'auto' : undefined, maxHeight: isFullscreen ? '100vh' : undefined }}>
      <Group gap="xs" mb={12} justify="space-between">
        <Text size="xs" c="dimmed">
          {nodes.length} 节点 · {edges.length} 依赖边 · {numbering?.byNode.size ?? 0} 插件参与本次对话
          <span style={{ color: 'var(--mantine-color-teal-5)' }}>（绿圈 = 参与）</span>
        </Text>
        <Group gap="xs">
          <Switch size="xs" label="隐藏禁用" checked={hideDisabled} onChange={(e) => setHideDisabled(e.currentTarget.checked)} />
          <Switch size="xs" label="隐藏 UI" checked={hideUI} onChange={(e) => setHideUI(e.currentTarget.checked)} />
          <Switch size="xs" label="仅依赖节点" checked={hideUnused} onChange={(e) => setHideUnused(e.currentTarget.checked)} />
          <ActionIcon size="sm" variant="light" onClick={() => setZoom((z) => Math.min(2, z + 0.2))} title="放大">+</ActionIcon>
          <Text size="xs" c="dimmed">{Math.round(zoom * 100)}%</Text>
          <ActionIcon size="sm" variant="light" onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))} title="缩小">−</ActionIcon>
          <ActionIcon variant="light" size="sm" onClick={toggleFullscreen} title={isFullscreen ? '退出全屏' : '全屏'}>
            {isFullscreen ? '✕' : '⛶'}
          </ActionIcon>
        </Group>
      </Group>

      <Box onWheel={onWheel} style={{ overflow: 'auto', maxHeight: isFullscreen ? 'calc(100vh - 80px)' : undefined, position: 'relative' }}>
        <svg width={width * zoom} height={height * zoom} style={{ display: 'block' }}>
          <g transform={`scale(${zoom})`}>
          {/* 依赖边 */}
          {edges.map((e) => {
            const a = pos.get(e.from)
            const b = pos.get(e.to)
            if (!a || !b) return null
            const isHoverEdge = hoverId === e.from || hoverId === e.to
            const dimmed = hoverId !== null && !isHoverEdge
            const x1 = a.x + NODE_W
            const y1 = a.y + NODE_H / 2
            const x2 = b.x
            const y2 = b.y + NODE_H / 2
            const mx = (x1 + x2) / 2
            return (
              <g key={e.id} opacity={dimmed ? 0.15 : isHoverEdge ? 1 : 0.5}>
                <path d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`} fill="none" stroke={isHoverEdge ? '#74c0fc' : '#4a5568'} strokeWidth={isHoverEdge ? 1.5 : 1} markerEnd={`url(#arrow-${isHoverEdge ? 'lit' : 'dim'})`} />
              </g>
            )
          })}
          <defs>
            <marker id="arrow-dim" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6" fill="#4a5568" />
            </marker>
            <marker id="arrow-lit" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L6,3 L0,6" fill="#74c0fc" />
            </marker>
          </defs>

          {/* 节点 */}
          {nodes.map((id) => {
            const p = nodeById.get(id)!
            const q = pos.get(id)!
            const order = activityMap.get(p.id) ?? null
            const isHover = hoverId === id
            const isDim = hoverId !== null && !hoverAdj.has(id)
            const color = COLORS[categorize(p.name)] ?? '#868e96'
            const disabled = !p.enabled

            return (
              <g
                key={id}
                onMouseEnter={() => setHoverId(id)}
                onMouseLeave={() => setHoverId((cur) => (cur === id ? null : cur))}
                onClick={() => setSelectedId(id)}
                style={{ cursor: 'pointer' }}
                opacity={isDim ? 0.25 : 1}
              >
                <rect
                  x={q.x} y={q.y} width={NODE_W} height={NODE_H} rx={5}
                  fill={isHover ? 'var(--fv-node-hover)' : 'var(--mantine-color-dark-6)'}
                  stroke={isHover ? '#74c0fc' : order !== null ? '#12b886' : 'var(--mantine-color-dark-5)'}
                  strokeWidth={isHover ? 2 : 1}
                />
                <circle cx={q.x + 10} cy={q.y + 8} r={3} fill={color} />
                <text x={q.x + 20} y={q.y + 17} fill={disabled ? 'var(--fv-text-3)' : order !== null ? 'var(--fv-text-strong)' : 'var(--fv-text-2)'} fontSize={10} fontFamily="monospace">
                  {id.length > 22 ? id.slice(0, 22) + '…' : id}
                </text>
                {order !== null && (
                  <g>
                    <circle cx={q.x + NODE_W - 11} cy={q.y + NODE_H / 2} r={8} fill="#12b886" />
                    <text x={q.x + NODE_W - 11} y={q.y + NODE_H / 2 + 3.5} textAnchor="middle" fill="white" fontSize={9} fontWeight={700}>{order}</text>
                  </g>
                )}
              </g>
            )
          })}
          </g>
        </svg>

        {/* 节点旁 Popover 详情 */}
        {selectedNode && pos.get(selectedNode.id) && (() => {
          const q = pos.get(selectedNode.id)!
          const POP_W = 280
          const right = (q.x + NODE_W) * zoom + 10
          const left = right + POP_W > width * zoom + 40 ? Math.max(q.x * zoom - POP_W - 10, 4) : right
          return (
            <Box
              p="xs"
              style={{
                position: 'absolute',
                left,
                top: q.y * zoom,
                width: POP_W,
                zIndex: 10,
                border: '1px solid var(--mantine-color-dark-4)',
                borderRadius: 8,
                background: 'var(--mantine-color-dark-7)',
                boxShadow: '0 4px 16px rgba(0,0,0,0.18)',
              }}
            >
              <Group gap={6} mb={6} justify="space-between" wrap="nowrap">
                <Text size={11} lh={1.5} fw={700} truncate style={{ fontFamily: 'monospace' }}>{selectedNode.id}</Text>
                <ActionIcon size="xs" variant="subtle" onClick={() => setSelectedId(null)}>✕</ActionIcon>
              </Group>
              <Stack gap={4}>
                <Text size={10} lh={1.5} c="dimmed" truncate>包名：<span style={{ fontFamily: 'monospace' }}>{selectedNode.name}</span></Text>
                <Text size={10} lh={1.5} c="dimmed">域：{categorize(selectedNode.name)}</Text>
                <Text size={10} lh={1.5} c="dimmed">
                  阶段：<Badge variant="light" size="xs" color={selectedNode.phase === 'active' ? 'teal' : selectedNode.phase === 'failed' ? 'red' : 'gray'}>{selectedNode.phase}</Badge>
                </Text>
                {selectedNode.provides.length > 0 && (
                  <Group gap={4}>
                    <Text size={10} lh={1.5} c="dimmed" style={{ flexShrink: 0 }}>提供：</Text>
                    {selectedNode.provides.slice(0, 6).map((s) => (
                      <Badge key={s} variant="light" size="xs" color="teal" styles={{ label: { fontFamily: 'monospace' } }}>{s}</Badge>
                    ))}
                    {selectedNode.provides.length > 6 && <Text size={10} lh={1.5} c="dimmed">+{selectedNode.provides.length - 6}</Text>}
                  </Group>
                )}
                {selectedNode.inject.length > 0 && (
                  <Group gap={4}>
                    <Text size={10} lh={1.5} c="dimmed" style={{ flexShrink: 0 }}>依赖：</Text>
                    {selectedNode.inject.slice(0, 6).map((s) => (
                      <Badge key={s} variant="light" size="xs" color="blue" styles={{ label: { fontFamily: 'monospace' } }}>{s}</Badge>
                    ))}
                    {selectedNode.inject.length > 6 && <Text size={10} lh={1.5} c="dimmed">+{selectedNode.inject.length - 6}</Text>}
                  </Group>
                )}
              </Stack>
            </Box>
          )
        })()}
      </Box>

      <Group gap="md" mt={8}>
        <Text size="xs" c="dimmed">hover 高亮依赖边，点击在节点旁看详情</Text>
        <Text size="xs" c="dimmed">圆点颜色 = 功能域</Text>
        <Text size="xs" c="dimmed">绿圈数字 = 参与顺序</Text>
      </Group>
    </Box>
  )
}
