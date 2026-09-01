/**
 * Structural types mirroring the DSH 0.1.1-rc.2 host contracts this plugin
 * consumes. Kept local so the build stays hermetic (types verified against the
 * installed .d.ts; re-verify on every DSH upgrade).
 */
import type { IncomingMessage, ServerResponse } from 'node:http'

// ---- RPC envelope ----------------------------------------------------------

export interface RpcRequest<P> {
  rpcId: string
  payload: P
}

export type RpcError = { code: string; message: string; details: unknown }

export type RpcResult<T> = { ok: true; value: T } | { ok: false; error: RpcError }

export interface RpcResponse<T> {
  rpcId: string
  result: RpcResult<T>
}

// ---- Session events --------------------------------------------------------

export interface ContentBlockLike {
  type: string
  text?: string
  [k: string]: unknown
}

/** SessionEvent: business payload lives under `data` (verified in spike). */
export interface SessionEventLike {
  type: string
  seq?: number
  time?: number
  data?: {
    turn?: number
    step?: number
    message?: { content?: ContentBlockLike[] }
    [k: string]: unknown
  }
  [k: string]: unknown
}

// ---- Mux / host frames -----------------------------------------------------

export interface MuxFrame {
  type: string
  sessionId?: string
  event?: SessionEventLike
  lastSeq?: number
  /** question/requested */
  questions?: QuestionItem[]
  /** question/resolved */
  questionRpcId?: string
  outcome?: string
  /** approval/requested */
  approvalId?: string
  toolName?: string
  callId?: string
  reason?: string
  /** session/projection */
  key?: string
  value?: unknown
  seq?: number
  /** stream/error */
  error?: RpcError
  [k: string]: unknown
}

export interface HostFrame {
  type: string
  sessionId?: string
  running?: boolean
  message?: string
  [k: string]: unknown
}

// ---- Questions / approvals -------------------------------------------------

export interface QuestionOption {
  label: string
  description?: string
}

export interface QuestionItem {
  id: string
  question: string
  detail?: string
  header?: string
  options?: QuestionOption[]
  multiSelect?: boolean
  intent?: unknown
}

export interface QuestionAnswerItem {
  id: string
  selected: string[]
  custom?: string
}

export interface QuestionResponsePayload {
  sessionId: string
  answer: { answers: QuestionAnswerItem[] }
}

export interface ApprovalResponsePayload {
  sessionId: string
  approvalId: string
  outcome: 'allowed-once' | 'rejected'
}

export interface ClientResponse {
  type: 'client-response'
  rpcId: string
  result: RpcResult<unknown>
}

// ---- ApiProxy surface consumed here ----------------------------------------

export interface HistoryEntry {
  event: SessionEventLike
  view?: unknown
}

export interface SessionsApi {
  create(
    request: RpcRequest<{ workspaceId?: string; cwd?: string; sessionId?: string; agentPreset?: string }>,
  ): Promise<RpcResponse<{ sessionId: string; agentPreset?: string }>>
  prompt(
    request: RpcRequest<{
      sessionId: string
      mode: 'queue' | 'steer'
      content: Array<{ type: 'text'; text: string }>
      clientTimeZone?: string
    }>,
  ): Promise<RpcResponse<{ accepted: true }>>
  history(
    request: RpcRequest<{ sessionId: string; beforeSeq?: number; maxMessages?: number }>,
  ): Promise<RpcResponse<{ events: HistoryEntry[]; hasMore: boolean }>>
  cancel(request: RpcRequest<{ sessionId: string }>): Promise<RpcResponse<{ accepted: true }>>
}

export interface EventsApi {
  mux(
    request: RpcRequest<{ since?: Record<string, number> }>,
    signal: AbortSignal,
  ): AsyncIterable<RpcRequest<MuxFrame>>
  host(request: RpcRequest<Record<string, never>>, signal: AbortSignal): AsyncIterable<RpcRequest<HostFrame>>
}

export interface ApiProxy {
  sessions: SessionsApi
  events: EventsApi
  respond(message: ClientResponse): Promise<{ accepted: true } | { accepted: false; reason: string }>
}

// ---- WebServer surface -----------------------------------------------------

export interface WebRoute {
  kind: 'exact' | 'prefix'
  path: string
  handler: (req: IncomingMessage, res: ServerResponse) => void | Promise<void>
}

export interface WebServer {
  register(route: WebRoute): () => void
}

export interface Ctx {
  webServer: WebServer
  apiProxy: ApiProxy
}
