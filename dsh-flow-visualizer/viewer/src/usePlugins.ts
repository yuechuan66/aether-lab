import { useEffect, useState } from 'react'
import type { PluginNode } from './types'

/** 拉取插件清单（/plugins），供插件树与调度序列共用。 */
export function usePlugins(): PluginNode[] | null {
  const [plugins, setPlugins] = useState<PluginNode[] | null>(null)

  useEffect(() => {
    let cancelled = false
    fetch('/plugins')
      .then((r) => r.json())
      .then((data) => {
        if (!cancelled) setPlugins(data.plugins ?? [])
      })
      .catch(() => {
        if (!cancelled) setPlugins([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  return plugins
}
