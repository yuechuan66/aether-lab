import { useEffect } from 'react'
import { useViewerStore } from './store'
import type { FlowEvent, FlowTrace, TraceStatus } from './types'

export function useEventStream() {
  const setConnected = useViewerStore((s) => s.setConnected)
  const upsertEvent = useViewerStore((s) => s.upsertEvent)
  const applyTrace = useViewerStore((s) => s.applyTrace)
  const finishTrace = useViewerStore((s) => s.finishTrace)

  useEffect(() => {
    const es = new EventSource('/events')

    es.addEventListener('trace.list', (e) => {
      const { traceIds } = JSON.parse(e.data)
      // 仅记录会话存在；具体数据由 trace.init 填充
      for (const id of traceIds) {
        useViewerStore.getState().applyTrace({
          traceId: id,
          sessionId: id,
          startTime: 0,
          endTime: null,
          events: [],
          totalDuration: null,
          totalTokens: null,
          toolCallCount: 0,
          status: 'running',
        } as FlowTrace)
      }
    })

    es.addEventListener('trace.init', (e) => {
      const trace = JSON.parse(e.data) as FlowTrace
      applyTrace(trace)
    })

    es.addEventListener('event', (e) => {
      const ev = JSON.parse(e.data) as FlowEvent
      upsertEvent(ev)
    })

    es.addEventListener('trace.end', (e) => {
      const { traceId, status } = JSON.parse(e.data) as { traceId: string; status: TraceStatus }
      finishTrace(traceId, status)
    })

    es.onopen = () => setConnected(true)
    es.onerror = () => setConnected(false)

    return () => {
      es.close()
    }
  }, [setConnected, upsertEvent, applyTrace, finishTrace])
}
