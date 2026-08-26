import { useEffect, useRef, useState } from 'react'

const PORTS = [9527, 9528, 9529, 9530, 9531, 9532]

/** 本机探测 flow-tracer 服务端口（服务端 CORS *，探测失败静默） */
async function discoverPort(): Promise<number | null> {
  const results = await Promise.all(
    PORTS.map(async (p) => {
      try {
        const ctrl = new AbortController()
        const timer = setTimeout(() => ctrl.abort(), 300)
        const res = await fetch(`http://127.0.0.1:${p}/plugins`, { signal: ctrl.signal })
        clearTimeout(timer)
        return res.ok ? p : null
      } catch {
        return null
      }
    }),
  )
  return results.find((x) => x !== null) ?? null
}

const wrap: React.CSSProperties = {
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: '#666',
  fontSize: 13,
}

/** 「数据流」tab 组件：iframe 嵌入插件自带 Viewer，按会话深链。 */
export function FlowTab(props: any) {
  const sessionId: string | null = props?.sessionId ?? props?.session?.id ?? null
  const [port, setPort] = useState<number | null | 'searching'>('searching')
  const [alive, setAlive] = useState<boolean | 'waiting'>('waiting')
  const [loaded, setLoaded] = useState(false)
  const portRef = useRef<number | null>(null)

  useEffect(() => {
    let cancelled = false
    discoverPort().then((p) => {
      if (cancelled) return
      portRef.current = p
      setPort(p)
    })
    return () => {
      cancelled = true
    }
  }, [])

  // viewer 挂载后 postMessage 握手；iframe 加载完 2.5s 仍无握手 = 内部 JS 被宿主拦截
  useEffect(() => {
    const onMsg = (e: MessageEvent) => {
      if (e.data?.source === 'dsh-flow-viewer' && e.data?.type === 'ready') setAlive(true)
    }
    window.addEventListener('message', onMsg)
    return () => window.removeEventListener('message', onMsg)
  }, [])

  useEffect(() => {
    if (!loaded || alive !== 'waiting') return
    const t = setTimeout(() => setAlive((a) => (a === 'waiting' ? false : a)), 2500)
    return () => clearTimeout(t)
  }, [loaded, alive])

  if (port === 'searching') return <div style={wrap}>正在连接数据流服务…</div>
  if (port === null) {
    return <div style={wrap}>未检测到 flow-tracer 服务（127.0.0.1:9527-9532），确认 DSH 已加载该插件</div>
  }

  const params = new URLSearchParams()
  params.set('embed', '1')
  if (sessionId) params.set('session', sessionId)
  const src = `http://127.0.0.1:${port}/?${params.toString()}`

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <iframe
        src={src}
        title="DSH 数据流"
        onLoad={() => setLoaded(true)}
        style={{
          width: '100%',
          height: '100%',
          border: '1px solid #d0d3d9',
          borderRadius: 10,
          background: '#1a1b1e',
          display: 'block',
        }}
      />
      {alive === false && (
        <div
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.92)',
            borderRadius: 10,
            color: '#444',
            fontSize: 13,
            textAlign: 'center',
            padding: 24,
          }}
        >
          <div>iframe 已加载但 viewer 未响应，可能被宿主安全策略拦截。</div>
          <div style={{ fontFamily: 'monospace', fontSize: 11, color: '#888' }}>{src}</div>
          <button
            onClick={() => window.open(src.replace('embed=1&', ''), '_blank')}
            style={{
              padding: '6px 14px',
              borderRadius: 6,
              border: '1px solid #c6c9cf',
              background: '#fff',
              cursor: 'pointer',
              fontSize: 13,
            }}
          >
            独立窗口打开
          </button>
        </div>
      )}
    </div>
  )
}
