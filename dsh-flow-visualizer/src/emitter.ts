import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import type { Collector, ResolvedConfig } from './collector.ts'
import type { FlowEvent, FlowTrace, SseMessageType } from './types.ts'
import type { PluginNode } from './plugins.ts'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
// 插件源码位于 <root>/src，viewer 构建产物位于 <root>/viewer/dist
const VIEWER_DIST = path.resolve(__dirname, '..', 'viewer', 'dist')

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
}

/** 跨平台打开浏览器，失败静默（不阻塞启动） */
function openBrowser(url: string): void {
  const cmd = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open'
  try {
    const child = spawn(cmd, [url], { stdio: 'ignore', detached: true })
    child.on('error', () => {})
    child.unref()
  } catch {
    // 无桌面环境时忽略
  }
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const urlPath = (req.url === '/' ? '/index.html' : req.url) ?? '/index.html'
  // 防止路径穿越
  const filePath = path.join(VIEWER_DIST, path.normalize(urlPath))
  if (!filePath.startsWith(VIEWER_DIST)) return false
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) return false

  const ext = path.extname(filePath).toLowerCase()
  res.writeHead(200, { 'Content-Type': CONTENT_TYPES[ext] ?? 'application/octet-stream' })
  res.end(fs.readFileSync(filePath))
  return true
}

export class Emitter {
  private clients = new Set<http.ServerResponse>()
  private server?: http.Server
  private readonly opts: ResolvedConfig
  private readonly collector: Collector
  private pluginProvider: () => PluginNode[] = () => []

  constructor(opts: ResolvedConfig, collector: Collector) {
    this.opts = opts
    this.collector = collector
  }

  setPluginProvider(provider: () => PluginNode[]): void {
    this.pluginProvider = provider
  }

  start(): void {
    this.server = http.createServer((req, res) => {
      if (req.url === '/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'Access-Control-Allow-Origin': '*',
        })
        this.clients.add(res)
        req.on('close', () => this.clients.delete(res))
        const ids = this.collector.traceIds()
        this.send('trace.list', { traceIds: ids })
        for (const id of ids) {
          const trace = this.collector.getTrace(id)
          if (trace) this.send('trace.init', trace)
        }
        return
      }

      if (req.url?.startsWith('/trace/') && req.method === 'GET') {
        const traceId = decodeURIComponent(req.url.split('/trace/')[1])
        const trace = this.collector.getTrace(traceId)
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify(trace ?? null))
        return
      }

      if (req.url === '/unmapped-tools' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ tools: this.collector.unmappedToolList() }))
        return
      }

      // 插件清单
      if (req.url === '/plugins' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ plugins: this.pluginProvider() }))
        return
      }

      // 静态文件：React 前端（viewer/dist）
      if (req.method === 'GET' && serveStatic(req, res)) return

      res.writeHead(404, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ error: 'not found' }))
    })

    this.tryListen(this.opts.port, 5)
  }

  /** 端口冲突时顺延重试（最多 5 次），避免 EADDRINUSE 直接崩 */
  private tryListen(port: number, attemptsLeft: number): void {
    const server = this.server
    if (!server) return
    const onError = (err: NodeJS.ErrnoException) => {
      server.removeListener('error', onError)
      if (err.code === 'EADDRINUSE' && attemptsLeft > 0) {
        console.log(`[flow-tracer] port ${port} in use, trying ${port + 1}`)
        this.tryListen(port + 1, attemptsLeft - 1)
      } else {
        console.error(`[flow-tracer] viewer server failed: ${err.message}`)
      }
    }
    server.once('error', onError)
    server.listen(port, '127.0.0.1', () => {
      server.removeListener('error', onError)
      const url = `http://127.0.0.1:${port}`
      console.log(`[flow-tracer] Viewer at ${url}`)
      if (this.opts.autoOpen) openBrowser(url)
    })
  }

  send(type: SseMessageType, payload: unknown): void {
    const data = `event: ${type}\ndata: ${JSON.stringify(payload)}\n\n`
    for (const client of this.clients) {
      client.write(data)
    }
  }

  emitEvent(event: FlowEvent): void {
    this.send('event', event)
  }

  emitTraceEnd(traceId: string, status: FlowTrace['status'], duration: number | null): void {
    this.send('trace.end', { traceId, status, duration })
  }

  async close(): Promise<void> {
    for (const client of this.clients) client.end()
    this.clients.clear()
    if (!this.server) return
    await new Promise<void>((resolve, reject) => {
      this.server!.close((error) => (error ? reject(error) : resolve()))
    })
    this.server = undefined
  }
}
