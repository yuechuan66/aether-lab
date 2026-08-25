import { useMemo } from 'react'
import { Box, Text, Tooltip } from '@mantine/core'
import { getSessionEvents, useViewerStore } from '../store'
import { fmtDuration } from '../format'
import type { FlowEvent } from '../types'

const LANE_HEIGHT = 40
const LANE_GAP = 4
const AXIS_HEIGHT = 36
const PADDING_LEFT = 230
const PADDING_RIGHT = 30
const MIN_BLOCK_W = 8
const GAP_THRESHOLD = 2000 // 事件间隔超过 2 秒视为空闲，压缩
const GAP_WIDTH = 40       // 空闲区间压缩后的固定宽度
const MAX_BLOCK_W = 300    // 事件方块最大宽度（超长事件封顶）

/** 泳道图只显示有意义的阶段，过滤流水账。 */
function isVisible(ev: FlowEvent): boolean {
  switch (ev.phase) {
    case 'session.event': {
      const t = (ev.input as any)?.type
      return t === 'tool/call' || t === 'tool/result' || t === 'assistant/message' || t === 'user/message'
    }
    default:
      return true
  }
}

/** 把无插件名的事件归到 agent-loop 泳道。 */
function laneNameOf(ev: FlowEvent): string {
  const name = ev.pluginName || ''
  if (name) return name
  if (ev.phase.startsWith('agent.')) return 'agent-loop'
  return '其他'
}

function blockColor(ev: FlowEvent): string {
  if (ev.status === 'error') return 'var(--mantine-color-red-6)'
  switch (ev.phase) {
    case 'tools.execute': return 'var(--mantine-color-teal-7)'
    case 'llm.stream': return 'var(--mantine-color-indigo-6)'
    case 'agent.request': return 'var(--mantine-color-blue-6)'
    case 'agent.pre-step': return 'var(--mantine-color-blue-4)'
    case 'tools.pre-execute':
    case 'tools.post-execute':
      return 'var(--mantine-color-teal-9)'
    case 'tools.result': return 'var(--mantine-color-teal-5)'
    case 'session.event': return 'var(--mantine-color-gray-6)'
    default: return 'var(--mantine-color-gray-7)'
  }
}

interface ScaledBlock {
  ev: FlowEvent
  x: number
  width: number
}

/** 压缩时间轴：空闲区间压成固定宽度，事件内部保持真实耗时（封顶）。 */
function buildCompressedScale(events: FlowEvent[]): { blocks: ScaledBlock[]; totalWidth: number; ticks: Array<{ x: number; time: number }> } {
  const sorted = [...events].sort((a, b) => a.timestamp - b.timestamp)
  const blocks: ScaledBlock[] = []

  let x = PADDING_LEFT
  let prevEnd: number | null = null

  for (const ev of sorted) {
    const start = ev.timestamp
    const dur = ev.duration ?? 0
    const end = start + dur

    if (prevEnd !== null && start > prevEnd) {
      const gap = start - prevEnd
      x += gap >= GAP_THRESHOLD ? GAP_WIDTH : gap
    }

    const width = Math.min(Math.max(dur, MIN_BLOCK_W), MAX_BLOCK_W)
    blocks.push({ ev, x, width })
    x += width
    prevEnd = end
  }

  // 刻度稀疏化：间隔至少 110px 才画一个，避免文字重叠
  const ticks: Array<{ x: number; time: number }> = []
  let lastTickX = -Infinity
  for (const b of blocks) {
    if (b.x - lastTickX >= 110) {
      ticks.push({ x: b.x, time: b.ev.timestamp })
      lastTickX = b.x
    }
  }

  return { blocks, totalWidth: x + PADDING_RIGHT, ticks }
}

export function SwimlaneView() {
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)

  const { session, lanes, blocks, totalWidth, ticks } = useMemo(() => {
    const ses = currentSessionId ? sessions.get(currentSessionId) : undefined
    const all = getSessionEvents({ currentSessionId, sessions } as any)
    const visible = all.filter((x) => isVisible(x.ev)).map((x) => x.ev)

    const laneMap = new Map<string, FlowEvent[]>()
    for (const ev of visible) {
      const name = laneNameOf(ev)
      if (!laneMap.has(name)) laneMap.set(name, [])
      laneMap.get(name)!.push(ev)
    }
    const lanes = [...laneMap.entries()].map(([name, evs]) => ({ name, evs }))

    const { blocks, totalWidth, ticks } = buildCompressedScale(visible)

    return { session: ses, lanes, blocks, totalWidth, ticks }
  }, [currentSessionId, sessions])

  if (!session || blocks.length === 0) {
    return <Text c="dimmed" ta="center" py="xl">暂无事件，去 DSH 发条消息吧</Text>
  }

  const laneIndex = new Map<string, number>()
  lanes.forEach((lane, i) => laneIndex.set(lane.name, i))
  const yOf = (name: string) => AXIS_HEIGHT + laneIndex.get(name)! * (LANE_HEIGHT + LANE_GAP) + LANE_HEIGHT / 2
  const svgHeight = AXIS_HEIGHT + lanes.length * (LANE_HEIGHT + LANE_GAP) + 16
  const blockX = new Map<string, ScaledBlock>()
  for (const b of blocks) blockX.set(b.ev.id, b)

  return (
    <Box style={{ overflowX: 'auto', border: '1px solid var(--mantine-color-dark-4)', borderRadius: 8, padding: 12 }}>
      <svg width={Math.max(totalWidth, 800)} height={svgHeight} style={{ display: 'block' }}>
        {/* 时间轴刻度（稀疏化，标注真实时间） */}
        {ticks.map((tick, i) => (
          <g key={i}>
            <line x1={tick.x} y1={AXIS_HEIGHT - 20} x2={tick.x} y2={svgHeight - 8} stroke="var(--mantine-color-dark-5)" strokeWidth={1} strokeDasharray="2 4" />
            <text x={tick.x} y={14} fill="var(--mantine-color-gray-5)" fontSize={10} textAnchor="middle">
              {fmtTimeShort(tick.time)}
            </text>
          </g>
        ))}

        {/* 泳道 + 方块 */}
        {lanes.map((lane) => {
          const y = yOf(lane.name)
          const top = y - LANE_HEIGHT / 2
          return (
            <g key={lane.name}>
              <rect x={0} y={top} width={Math.max(totalWidth, 800)} height={LANE_HEIGHT} fill="var(--mantine-color-dark-6)" rx={4} opacity={0.5} />
              <text x={12} y={y + 4} fill="var(--mantine-color-gray-3)" fontSize={12} fontFamily="monospace">
                {lane.name.length > 30 ? lane.name.slice(0, 30) + '…' : lane.name}
              </text>
              {lane.evs.map((ev) => {
                const b = blockX.get(ev.id)!
                return (
                  <Tooltip key={ev.id} withArrow label={`${ev.phase} · ${fmtDuration(ev.duration)} · ${ev.pluginName || lane.name}`}>
                    <rect x={b.x} y={top + 20} width={b.width} height={LANE_HEIGHT - 22} rx={3} fill={blockColor(ev)} opacity={0.9} cursor="pointer" />
                  </Tooltip>
                )
              })}
            </g>
          )
        })}

        {/* 流转箭头 */}
        {blocks.slice(0, -1).map((b, i) => {
          const next = blocks[i + 1]
          const fromY = yOf(laneNameOf(b.ev))
          const toY = yOf(laneNameOf(next.ev))
          const fromX = b.x + b.width
          const toX = next.x
          if (toX < fromX) return null
          return (
            <path
              key={`flow-${i}`}
              d={`M ${fromX} ${fromY} C ${fromX + 12} ${fromY}, ${toX - 12} ${toY}, ${toX} ${toY}`}
              fill="none"
              stroke="var(--mantine-color-gray-6)"
              strokeWidth={1}
              opacity={0.35}
              markerEnd="url(#arrow)"
            />
          )
        })}
        <defs>
          <marker id="arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
            <path d="M0,0 L6,3 L0,6" fill="var(--mantine-color-gray-6)" />
          </marker>
        </defs>
      </svg>

      <Box mt="xs" style={{ display: 'flex', gap: 16, flexWrap: 'wrap', fontSize: 12 }}>
        <Legend color="var(--mantine-color-blue-4)" label="agent 阶段" />
        <Legend color="var(--mantine-color-indigo-6)" label="模型调用" />
        <Legend color="var(--mantine-color-teal-7)" label="工具执行" />
        <Legend color="var(--mantine-color-gray-6)" label="会话记录" />
        <Legend color="var(--mantine-color-red-6)" label="错误" />
        <Text size="xs" c="dimmed">⚠ 空闲区间已压缩，hover 看真实耗时</Text>
      </Box>
    </Box>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <Box style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 12, height: 12, background: color, borderRadius: 3, display: 'inline-block' }} />
      <Text size="xs" c="dimmed">{label}</Text>
    </Box>
  )
}

function fmtTimeShort(ts: number): string {
  const d = new Date(ts)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}
