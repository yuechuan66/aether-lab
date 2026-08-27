import { useEffect, useRef, useState } from 'react'
import { AppBody } from '../../viewer/src/App'
import { setApiBase } from '../../viewer/src/apiBase'
import { injectStyles } from '../../viewer/src/styles'

const PORTS = [9527, 9528, 9529, 9530, 9531, 9532]

async function discoverPort(): Promise<number | null> {
  for (const p of PORTS) {
    try {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), 300)
      const res = await fetch(`http://127.0.0.1:${p}/plugins`, { signal: ctrl.signal })
      clearTimeout(timer)
      if (res.ok) return p
    } catch {
      // 下一个
    }
  }
  return null
}

/** 宿主主题：body[data-ds-dark-theme]（同 dsh-plugin-agent-workflow 信号） */
function useHostDark(): boolean {
  const [dark, setDark] = useState(() => document.body.hasAttribute('data-ds-dark-theme'))
  useEffect(() => {
    const ob = new MutationObserver(() => setDark(document.body.hasAttribute('data-ds-dark-theme')))
    ob.observe(document.body, { attributes: true, attributeFilter: ['data-ds-dark-theme'] })
    return () => ob.disconnect()
  }, [])
  return dark
}

/**
 * 「数据流」tab：原生渲染完整 Viewer（与独立页面一致，embed 无 header）。
 * 数据经 SSE 直连插件服务（桌面壳拦截 iframe 但不拦 fetch/SSE）。
 */
export function FlowTab(props: any) {
  const dark = useHostDark()
  const [port, setPort] = useState<number | null | 'searching'>('searching')
  // 固定容器：fixed 锁定到 tab 可视区（tab 行底 → 输入框顶），脱流故不撑宿主、无反馈循环；
  // 容器内部复用独立 Viewer 的自适应布局（事件明细/总线/插件树各自内滚）。
  const sentinelRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState<{ top: number; left: number; width: number; bottom: number } | null>(null)

  useEffect(() => {
    const measure = () => {
      const s = sentinelRef.current
      if (!s) return
      const tabEl = Array.from(document.querySelectorAll('[role="tab"]')).find((t) =>
        (t.textContent || '').includes('数据流'),
      ) as HTMLElement | undefined
      const ta = document.querySelector('textarea')
      const sr = s.getBoundingClientRect()
      const top = tabEl ? tabEl.getBoundingClientRect().bottom + 8 : sr.top
      const bottom = ta ? ta.getBoundingClientRect().top - 8 : window.innerHeight - 8
      setBox({ top, left: sr.left, width: sr.width, bottom: Math.max(bottom, top + 240) })
    }
    measure()
    const t1 = setTimeout(measure, 300)
    const t2 = setTimeout(measure, 1200)
    window.addEventListener('resize', measure)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('resize', measure)
    }
  }, [port])

  useEffect(() => {
    let cancelled = false
    discoverPort().then((p) => {
      if (!cancelled) setPort(p)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (typeof port === 'number') {
      setApiBase(`http://127.0.0.1:${port}`)
      injectStyles()
    }
  }, [port])

  if (port === 'searching') {
    return <div style={{ padding: 24, color: '#666', fontSize: 13 }}>正在连接数据流服务…</div>
  }
  if (port === null) {
    return (
      <div style={{ padding: 24, color: '#666', fontSize: 13 }}>
        未检测到 flow-tracer 服务（127.0.0.1:9527-9532），确认 DSH 已加载该插件
      </div>
    )
  }

  return (
    <>
      <div ref={sentinelRef} style={{ height: 0 }} />
      {box && (
        <div
          style={{
            position: 'fixed',
            top: box.top,
            left: box.left,
            width: box.width,
            height: box.bottom - box.top,
            zIndex: 5,
          }}
        >
          <AppBody embed sessionId={props?.sessionId ?? null} theme={dark ? 'dark' : 'light'} />
          <div style={{ position: 'absolute', right: 6, bottom: 4, fontSize: 9, color: '#9aa0ab', opacity: 0.6, pointerEvents: 'none' }}>
            flow-tracer 0.8.9
          </div>
        </div>
      )}
    </>
  )
}
