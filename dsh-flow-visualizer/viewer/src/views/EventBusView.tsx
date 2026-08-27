import { useMemo, useState } from 'react'
import { ActionIcon, Box, Group, Text, Tooltip } from '@mantine/core'
import { useElementSize } from '@mantine/hooks'
import { getSessionEvents, useViewerStore } from '../store'
import { eventDefByPhase, MODE_COLORS, MODE_LABEL, type DispatchMode } from '../eventDefs'
import { fmtDuration, fmtTime } from '../format'
import type { FlowEvent } from '../types'

// 紧凑四层：注册者（静态契约，虚线）/ 触发者 / 事件总线 / 监听者
const AXIS_H = 26
const DECLARER_Y = 44
const PRODUCER_Y = 74
const BUS_Y = 104
const LISTENER_Y = 134
const SVG_H = 160
const PAD_LEFT = 60
const PAD_RIGHT = 40
const GAP_THRESHOLD = 2000
const GAP_WIDTH = 48
const MAX_BLOCK_W = 320
const MIN_BLOCK_W = 18

// 瀑布图左侧标签列宽
const LABEL_W = 200
const TICK_H = 18

interface BusEvent {
  ev: FlowEvent
  def: { event: string; mode: DispatchMode; producer: string; desc: string } | undefined
  x: number
  width: number
  /** 展示用耗时：llm.stream 后端不回填 duration，前端按同 trace 的 assistant/message 时间差推导 */
  dur: number | null
}

/** 去包名前缀，不截断：'@deepseek-ai/dsh-tool-bash' -> 'tool-bash' */
function cleanName(name: string): string {
  return name.replace('@deepseek-ai/', '').replace('dsh-', '')
}

/** SVG 无 CSS ellipsis：按块宽反推可容纳字符数再截断（monospace ≈ 0.6em/字符） */
function fit(text: string, blockWidth: number, fontSize: number): string {
  const maxChars = Math.floor((blockWidth - 8) / (fontSize * 0.6))
  return text.length > maxChars ? text.slice(0, Math.max(maxChars - 1, 4)) + '…' : text
}

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Text size={10} lh={1.4} fw={700} tt="uppercase" lts={1.2} c="gray.6">
      {children}
    </Text>
  )
}

/** 真实时间轴瀑布：x = 时间戳比例，条宽 = 耗时。行高随可用高度自适应。 */
function TimeWaterfall({
  items,
  hoverIdx,
  onHover,
  selectedIdx,
  onSelect,
}: {
  items: BusEvent[]
  hoverIdx: number | null
  onHover: (i: number | null) => void
  selectedIdx: number | null
  onSelect: (i: number | null) => void
}) {
  const { ref, height } = useElementSize()

  const t0 = items[0].ev.timestamp
  const tEnd = Math.max(...items.map((it) => it.ev.timestamp + (it.dur ?? 0)))
  const span = Math.max(tEnd - t0, 1)
  const rowH = Math.min(96, Math.max(28, Math.floor((height - TICK_H - 4) / items.length)))

  return (
    <Box ref={ref} style={{ position: 'relative', flex: 1, minHeight: 120 }}>
      {/* 时间网格线（仅覆盖条形区） */}
      <Box style={{ position: 'absolute', top: 0, bottom: TICK_H, left: LABEL_W, right: 0 }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Box
            key={i}
            style={{
              position: 'absolute',
              top: 0,
              bottom: 0,
              left: `${i * 25}%`,
              borderLeft: '1px solid var(--mantine-color-dark-5)',
            }}
          />
        ))}
      </Box>

      {/* 行 */}
      {items.map((it, i) => {
        const leftPct = ((it.ev.timestamp - t0) / span) * 100
        const widthPct = ((it.dur ?? 0) / span) * 100
        const instant = (it.dur ?? 0) === 0
        const mode = it.def?.mode ?? 'emit'
        const color = MODE_COLORS[mode]
        const active = hoverIdx === i
        const selected = selectedIdx === i
        return (
          <Box
            key={i}
            onClick={() => onSelect(selected ? null : i)}
            onMouseEnter={() => onHover(i)}
            onMouseLeave={() => onHover((null))}
            style={{
              display: 'flex',
              alignItems: 'center',
              height: rowH,
              cursor: 'pointer',
              background: active || selected ? 'rgba(255,255,255,0.045)' : undefined,
              borderRadius: 4,
            }}
          >
            <Box style={{ width: LABEL_W, flexShrink: 0, paddingRight: 12, display: 'flex', alignItems: 'baseline', gap: 6 }}>
              <Text
                size={10}
                lh={1.4}
                fw={600}
                c={selected ? 'var(--fv-text-1)' : 'var(--fv-text-2)'}
                truncate
                style={{ fontFamily: 'monospace' }}
              >
                {it.def?.event ?? it.ev.phase}
              </Text>
              <Text size={9} lh={1.4} c="dimmed" style={{ marginLeft: 'auto', flexShrink: 0, fontFamily: 'monospace' }}>
                {it.dur == null ? '—' : fmtDuration(it.dur) || '0ms'}
              </Text>
            </Box>
            <Box style={{ position: 'relative', flex: 1, height: '100%' }}>
              <Box
                style={{
                  position: 'absolute',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  left: `${leftPct}%`,
                  width: `${widthPct}%`,
                  minWidth: instant ? 3 : 4,
                  height: instant ? 8 : Math.min(14, rowH - 16),
                  background: color,
                  opacity: instant ? 0.55 : active || selected ? 1 : 0.7,
                  borderRadius: instant ? 2 : 3,
                  boxShadow: selected ? '0 0 0 1.5px #fff' : undefined,
                }}
              />
            </Box>
          </Box>
        )
      })}

      {/* 时间刻度 */}
      <Box style={{ position: 'relative', height: TICK_H, marginLeft: LABEL_W }}>
        {[0, 1, 2, 3, 4].map((i) => (
          <Text
            key={i}
            size={9}
            lh={1.4}
            c="gray.6"
            style={{
              position: 'absolute',
              left: `${i * 25}%`,
              transform: i === 0 ? 'none' : i === 4 ? 'translateX(-100%)' : 'translateX(-50%)',
              fontFamily: 'monospace',
              whiteSpace: 'nowrap',
            }}
          >
            {fmtTime(t0 + (span * i) / 4)}
          </Text>
        ))}
      </Box>
    </Box>
  )
}

/** 选中事件的检查器：模式 / 触发者 / 监听者 / 输入输出快照。 */
function EventInspector({ item, onClose }: { item: BusEvent; onClose: () => void }) {
  const mode = item.def?.mode ?? 'emit'
  const producer = item.def?.producer ?? 'unknown'
  const listener = item.ev.pluginName || producer
  return (
    <Box
      mt={10}
      p={10}
      style={{
        border: '1px solid var(--mantine-color-dark-5)',
        borderLeft: `3px solid ${MODE_COLORS[mode]}`,
        borderRadius: 8,
        background: 'var(--mantine-color-dark-6)',
        flexShrink: 0,
      }}
    >
      <Group gap="xs" mb={8} wrap="nowrap">
        <Text size={11} lh={1.4} fw={700} c="var(--fv-text-strong)" style={{ fontFamily: 'monospace' }}>
          {item.def?.event ?? item.ev.phase}
        </Text>
        <Text size={10} lh={1.4} fw={600} c={MODE_COLORS[mode]}>
          {MODE_LABEL[mode]}
        </Text>
        <Text size={10} lh={1.4} c="dimmed" style={{ fontFamily: 'monospace' }} truncate>
          {cleanName(producer)} → {cleanName(listener)}
        </Text>
        <Text size={10} lh={1.4} c="dimmed" style={{ marginLeft: 'auto', flexShrink: 0, fontFamily: 'monospace' }}>
          {fmtTime(item.ev.timestamp)} · {item.dur == null ? '—' : fmtDuration(item.dur) || '0ms'}
        </Text>
        <ActionIcon size="xs" variant="subtle" c="dimmed" onClick={onClose} aria-label="关闭检查器">
          ✕
        </ActionIcon>
      </Group>
      {item.def?.desc && (
        <Text size={10} lh={1.4} c="var(--fv-text-3)" mb={6}>
          {item.def.desc}
        </Text>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        {(['input', 'output'] as const).map((k) => (
          <Box key={k} style={{ minWidth: 0 }}>
            <Eyebrow>{k === 'input' ? '输入' : '输出'}</Eyebrow>
            <pre
              style={{
                fontSize: 10,
                lineHeight: 1.5,
                margin: '4px 0 0',
                padding: 8,
                background: 'var(--mantine-color-dark-7)',
                borderRadius: 6,
                overflow: 'auto',
                maxHeight: 160,
                color: 'var(--fv-text-2)',
              }}
            >
              {JSON.stringify(k === 'input' ? item.ev.input : item.ev.output, null, 2) ?? 'null'}
            </pre>
          </Box>
        ))}
      </div>
    </Box>
  )
}

export function EventBusView() {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [zoom, setZoom] = useState(1)
  const currentSessionId = useViewerStore((s) => s.currentSessionId)
  const sessions = useViewerStore((s) => s.sessions)

  const items = useMemo(() => {
    const evs = getSessionEvents({ currentSessionId, sessions } as any).map((x) => x.ev)
    const meaningful = evs.filter((ev) => {
      if (ev.phase.startsWith('agent.')) return true
      if (ev.phase.startsWith('tools.')) return true
      if (ev.phase === 'llm.stream') return true
      return false
    })
    const sorted = [...meaningful].sort((a, b) => a.timestamp - b.timestamp)

    // llm.stream 耗时推导：同 trace 内首个晚于流起点的 assistant/message 时间差
    const assistantTsByTrace = new Map<string, number[]>()
    for (const ev of evs) {
      if (ev.phase !== 'session.event') continue
      if ((ev.input as any)?.type !== 'assistant/message') continue
      const arr = assistantTsByTrace.get(ev.traceId) ?? []
      arr.push(ev.timestamp)
      assistantTsByTrace.set(ev.traceId, arr)
    }
    const deriveDur = (ev: FlowEvent): number | null => {
      if (ev.duration != null) return ev.duration
      if (ev.phase !== 'llm.stream') return null
      const ts = assistantTsByTrace.get(ev.traceId) ?? []
      const hit = ts.find((t) => t >= ev.timestamp)
      return hit != null ? Math.max(hit - ev.timestamp, 0) : null
    }

    const result: BusEvent[] = []
    let x = PAD_LEFT
    let prevEnd: number | null = null
    for (const ev of sorted) {
      const dur = deriveDur(ev)
      const start = ev.timestamp
      const end = start + (dur ?? 0)
      if (prevEnd !== null && start > prevEnd) {
        // 间隙压缩：大间隙固定宽度，小间隙按 sqrt 缩放（毫秒直接当像素会导致秒级空白）
        const gap = start - prevEnd
        x += gap >= GAP_THRESHOLD ? GAP_WIDTH : Math.min(Math.max(Math.sqrt(gap) * 3, 4), GAP_WIDTH)
      }
      const width = Math.min(Math.max(dur ?? 0, MIN_BLOCK_W), MAX_BLOCK_W)
      // 方块宽度至少能放下短名文字
      const def0 = eventDefByPhase(ev.phase)
      const producerLabel = cleanName(def0?.producer ?? 'unknown')
      const listenerLabel = cleanName(ev.pluginName || def0?.producer || 'unknown')
      const eventShort = def0?.event?.split('/')[1] ?? ev.phase.split('.').pop() ?? ''
      const labelW = Math.max(producerLabel.length, listenerLabel.length, eventShort.length) * 5.5 + 14
      const w = Math.min(Math.max(width, labelW), MAX_BLOCK_W)
      result.push({ ev, def: def0, x, width: w, dur })
      x += w
      prevEnd = end
    }
    return result
  }, [currentSessionId, sessions])

  if (items.length === 0) {
    return <Text c="dimmed" ta="center" py="xl">暂无事件，去 DSH 发条消息吧</Text>
  }

  const totalWidth = items[items.length - 1].x + items[items.length - 1].width + PAD_RIGHT
  const selected = selectedIdx !== null ? items[selectedIdx] : null

  return (
    <Box p={12} style={{ minHeight: '100%', display: 'flex', flexDirection: 'column' }}>
      <Group gap="xs" mb={10} justify="space-between">
        <Text size="xs" c="dimmed">
          {items.length} 个调度事件 · hover 联动两视图，点击节点检查输入输出
        </Text>
        <Group gap={6}>
          <ActionIcon size="sm" variant="light" onClick={() => setZoom((z) => Math.min(2, z + 0.2))}>+</ActionIcon>
          <Text size="xs" c="dimmed" style={{ width: 36, textAlign: 'center' }}>{Math.round(zoom * 100)}%</Text>
          <ActionIcon size="sm" variant="light" onClick={() => setZoom((z) => Math.max(0.4, z - 0.2))}>−</ActionIcon>
        </Group>
      </Group>

      {/* 视图一：调度序列（压缩间隙） */}
      <Eyebrow>序列 · 间隙压缩</Eyebrow>
      <Box style={{ overflowX: 'auto', marginTop: 6 }}>
        <svg width={totalWidth * zoom} height={SVG_H * zoom} style={{ display: 'block' }}>
          <g transform={`scale(${zoom})`}>
            {/* 四层背景 */}
            <rect x={0} y={DECLARER_Y - 14} width={totalWidth} height={26} fill="rgba(255,255,255,0.02)" rx={4} />
            <rect x={0} y={PRODUCER_Y - 14} width={totalWidth} height={26} fill="rgba(79,140,255,0.07)" rx={4} />
            <rect x={0} y={BUS_Y - 14} width={totalWidth} height={26} fill="rgba(255,255,255,0.03)" rx={4} />
            <rect x={0} y={LISTENER_Y - 14} width={totalWidth} height={26} fill="rgba(18,184,134,0.05)" rx={4} />

            {/* 层标签 */}
            <text x={8} y={DECLARER_Y + 4} fill="var(--fv-text-3)" fontSize={10} fontWeight={700}>注册者</text>
            <text x={8} y={PRODUCER_Y + 4} fill="var(--fv-label-blue)" fontSize={10} fontWeight={700}>触发者</text>
            <text x={8} y={BUS_Y + 4} fill="var(--fv-text-2)" fontSize={10} fontWeight={700}>事件</text>
            <text x={8} y={LISTENER_Y + 4} fill="var(--fv-label-teal)" fontSize={10} fontWeight={700}>监听者</text>

            {/* 时间轴 */}
            {items.filter((_, i) => i % 2 === 0).map((it, i) => (
              <text key={`t${i}`} x={it.x} y={AXIS_H - 8} fill="var(--fv-text-3)" fontSize={9}>
                {fmtTime(it.ev.timestamp)}
              </text>
            ))}

            {/* 事件节点 */}
            {items.map((it, i) => {
              const mode = it.def?.mode ?? 'emit'
              const color = MODE_COLORS[mode]
              const cx = it.x + it.width / 2
              const isHover = hoverIdx === i
              const isSelected = selectedIdx === i
              const dimmed = hoverIdx !== null && !isHover
              const producer = it.def?.producer ?? 'unknown'
              const listener = it.ev.pluginName || producer
              const action = it.ev.phase.startsWith('tools.')
                ? it.ev.phase.replace('tools.', '')
                : it.ev.phase.startsWith('agent.')
                  ? it.ev.phase.replace('agent.', '')
                  : it.ev.phase

              const tip = `${it.def?.event ?? it.ev.phase} [${MODE_LABEL[mode]}]\n注册者: ${it.def?.owner ?? '未知'}\n触发者: ${producer}\n监听者: ${listener}\n动作: ${action} ${it.dur != null ? fmtDuration(it.dur) : ''}\n${it.def?.desc ?? ''}`

              return (
                <g
                  key={i}
                  opacity={dimmed ? 0.15 : 1}
                  style={{ cursor: 'pointer' }}
                  onClick={() => setSelectedIdx(isSelected ? null : i)}
                  onMouseEnter={() => setHoverIdx(i)}
                  onMouseLeave={() => setHoverIdx((c) => (c === i ? null : c))}
                >
                  {/* 注册者方块（虚线 = 静态契约关系，非运行时调用） */}
                  <rect x={it.x} y={DECLARER_Y - 8} width={it.width} height={16} rx={3} fill="none" stroke="var(--mantine-color-gray-7)" strokeWidth={1} strokeDasharray="3 2" />
                  <text x={cx} y={DECLARER_Y + 4} textAnchor="middle" fill="var(--fv-text-3)" fontSize={8} fontFamily="monospace">
                    {fit(cleanName(it.def?.owner ?? 'unknown'), it.width, 8)}
                  </text>

                  {/* 注册关系（虚线） */}
                  <line x1={cx} y1={DECLARER_Y + 8} x2={cx} y2={PRODUCER_Y - 8} stroke="var(--mantine-color-gray-7)" strokeWidth={1} strokeDasharray="3 3" opacity={0.5} />

                  {/* 触发者方块 */}
                  <rect x={it.x} y={PRODUCER_Y - 8} width={it.width} height={16} rx={3} fill={color} opacity={0.3} />
                  <text x={cx} y={PRODUCER_Y + 4} textAnchor="middle" fill="var(--fv-text-2)" fontSize={8} fontFamily="monospace">
                    {fit(cleanName(producer), it.width, 8)}
                  </text>

                  {/* 触发箭头 */}
                  <line x1={cx} y1={PRODUCER_Y + 8} x2={cx} y2={BUS_Y - 11} stroke={color} strokeWidth={isHover ? 2 : 1} opacity={0.55} markerEnd="url(#evt-arrow)" />

                  {/* 节点：事件名 + 分发模式（胶囊方块，放大可读） */}
                  <Tooltip withArrow multiline width={280} label={tip}>
                    <rect
                      x={it.x}
                      y={BUS_Y - 11}
                      width={it.width}
                      height={22}
                      rx={11}
                      fill={color}
                      stroke={isHover || isSelected ? '#fff' : 'none'}
                      strokeWidth={isHover || isSelected ? 2 : 0}
                    />
                  </Tooltip>
                  <text x={cx} y={BUS_Y + 3.5} textAnchor="middle" fill="white" fontSize={8.5} fontWeight={600} fontFamily="monospace">
                    {it.def?.event?.split('/')[1] ?? it.ev.phase.split('.').pop()}
                  </text>

                  {/* 调度箭头 */}
                  <line x1={cx} y1={BUS_Y + 11} x2={cx} y2={LISTENER_Y - 8} stroke="var(--mantine-color-teal-5)" strokeWidth={isHover ? 2 : 1} opacity={isHover ? 0.9 : 0.45} markerEnd="url(#evt-arrow-teal)" />

                  {/* 监听者方块 */}
                  <rect x={it.x} y={LISTENER_Y - 8} width={it.width} height={16} rx={3} fill="rgba(18,184,134,0.25)" stroke="var(--mantine-color-teal-6)" strokeWidth={1} />
                  <text x={cx} y={LISTENER_Y + 4} textAnchor="middle" fill="var(--fv-text-2)" fontSize={8} fontFamily="monospace">
                    {fit(cleanName(listener), it.width, 8)}
                  </text>
                </g>
              )
            })}

            <defs>
              <marker id="evt-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6" fill="#4f8cff" />
              </marker>
              <marker id="evt-arrow-teal" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
                <path d="M0,0 L6,3 L0,6" fill="#12b886" />
              </marker>
            </defs>
          </g>
        </svg>
      </Box>

      <Group gap="md" mt={6} mb={14}>
        {(['emit', 'waterfall', 'parallel', 'serial', 'bail'] as DispatchMode[]).map((m) => (
          <Group key={m} gap={4}>
            <span style={{ width: 8, height: 8, background: MODE_COLORS[m], borderRadius: 2, display: 'inline-block' }} />
            <Text size="xs" c="dimmed">{MODE_LABEL[m]}</Text>
          </Group>
        ))}
        <Group gap={4}>
          <span style={{ width: 8, height: 8, border: '1px dashed var(--mantine-color-gray-6)', borderRadius: 2, display: 'inline-block' }} />
          <Text size="xs" c="dimmed">虚线 = 注册者（声明事件契约的包）</Text>
        </Group>
      </Group>

      {/* 视图二：真实时间轴瀑布 */}
      <Group gap="xs" justify="space-between" mb={4}>
        <Eyebrow>耗时 · 真实时间轴</Eyebrow>
        <Text size={10} lh={1.4} c="gray.6" style={{ fontFamily: 'monospace' }}>
          span {fmtDuration(Math.max(...items.map((it) => it.ev.timestamp + (it.dur ?? 0))) - items[0].ev.timestamp)}
        </Text>
      </Group>
      <TimeWaterfall
        items={items}
        hoverIdx={hoverIdx}
        onHover={setHoverIdx}
        selectedIdx={selectedIdx}
        onSelect={setSelectedIdx}
      />

      {/* 选中检查器 */}
      {selected && <EventInspector item={selected} onClose={() => setSelectedIdx(null)} />}
    </Box>
  )
}
