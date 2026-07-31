import http from "node:http"
import type { AddressInfo } from "node:net"
import { randomUUID, timingSafeEqual } from "node:crypto"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js"
import type { IpcRouter } from "../ipc/router"
import type { RunEventBroker } from "../runner/run_event_broker"
import type { McpClientConfig } from "@shared/types/McpClientConfig"
import { createMcpServer } from "./server"
import { generateToken, loadToken, saveTokenInfo, type McpTokenInfo } from "./token-file"

/** SDK transport type after cast (see host.connect note). */
type Transport = Parameters<McpServer["connect"]>[0]
const SESSION_HEADER = "mcp-session-id"

/** Operational limits (plan §6). Kept small — this is a single-user loopback bridge. */
const DEFAULT_MAX_SESSIONS = 16
const DEFAULT_IDLE_TIMEOUT_MS = 10 * 60 * 1000 // 10 minutes

interface Session {
  readonly transport: StreamableHTTPServerTransport
  readonly server: McpServer
  idleTimer: NodeJS.Timeout | null
}

/** Fixed loopback port (decision #15). Falls back to an ephemeral port on collision. */
export const DEFAULT_MCP_PORT = 47271
export const MCP_PATH = "/mcp"
/** Loopback only — never 0.0.0.0. The whole security model rests on this. */
export const LOOPBACK_HOST = "127.0.0.1"

export interface McpHostOptions {
  readonly router: IpcRouter
  readonly tokenFilePath: string
  readonly version: string
  readonly preferredPort?: number
  readonly maxBodyBytes?: number
  /** When supplied, stateful sessions can subscribe to live run updates. */
  readonly broker?: RunEventBroker
  readonly maxSessions?: number
  readonly idleTimeoutMs?: number
}

/**
 * The opt-in loopback MCP server. Off until `start()`. Binds `127.0.0.1` only,
 * requires a static per-install bearer token on every request.
 *
 * Two transport modes coexist (Phase 6):
 * - Stateless one-shot: a sessionless, non-initialize POST gets a fresh MCP
 *   server + JSON-response transport per request. This is the documented poll
 *   fallback for `curl`/simple clients and keeps id spaces from colliding.
 * - Stateful session: an `initialize` POST opens a retained, session-scoped
 *   server + transport (keyed by a crypto-random session id) supporting POST
 *   for messages, GET for the server→client SSE stream, and DELETE for teardown.
 *   Only sessions carry resource subscriptions and update notifications.
 */
export class McpHost {
  private readonly router: IpcRouter
  private readonly tokenFilePath: string
  private readonly version: string
  private readonly preferredPort: number
  private readonly maxBodyBytes: number
  private readonly broker: RunEventBroker | undefined
  private readonly maxSessions: number
  private readonly idleTimeoutMs: number

  private httpServer: http.Server | null = null
  private token: string | null = null
  private info: McpTokenInfo | null = null
  private readonly sessions = new Map<string, Session>()
  // Serializes start()/stop() through a single-flight promise chain so a
  // concurrent start can't create a second server before `httpServer` is
  // assigned, and stop() always closes the server the in-flight start (if
  // any) actually ended up with — no orphaned/untracked listener.
  private lifecycle: Promise<unknown> = Promise.resolve()

  constructor(options: McpHostOptions) {
    this.router = options.router
    this.tokenFilePath = options.tokenFilePath
    this.version = options.version
    this.preferredPort = options.preferredPort ?? DEFAULT_MCP_PORT
    this.maxBodyBytes = options.maxBodyBytes ?? DEFAULT_MAX_MCP_BODY_BYTES
    this.broker = options.broker
    this.maxSessions = options.maxSessions ?? DEFAULT_MAX_SESSIONS
    this.idleTimeoutMs = options.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS
  }

  isRunning(): boolean {
    return this.httpServer !== null
  }

  /** Number of live stateful sessions — for status UI and lifecycle tests. */
  getSessionCount(): number {
    return this.sessions.size
  }

  /** Client config for the Setup-MCP dialog — the LIVE bound port, never a hardcoded 47271. */
  getConfig(): McpClientConfig | null {
    if (this.info === null) return null
    return {
      url: `http://${LOOPBACK_HOST}:${this.info.port}${MCP_PATH}`,
      token: this.info.token,
      port: this.info.port,
    }
  }

  async start(): Promise<McpTokenInfo> {
    return this.runExclusive(() => this.startLocked())
  }

  async stop(): Promise<void> {
    return this.runExclusive(() => this.stopLocked())
  }

  /** Run `fn` after every previously-queued start/stop has settled, never overlapping. */
  private runExclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lifecycle.then(fn, fn)
    this.lifecycle = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async startLocked(): Promise<McpTokenInfo> {
    if (this.info !== null) return this.info

    this.token = loadToken(this.tokenFilePath) ?? generateToken()
    const server = http.createServer((req, res) => {
      void this.handle(req, res)
    })

    let port: number
    try {
      port = await listen(server, this.preferredPort)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EADDRINUSE") {
        // FLAG 2: never brick on a busy port — take an ephemeral one and record it.
        port = await listen(server, 0)
      } else {
        throw error
      }
    }

    this.httpServer = server
    this.info = { token: this.token, port }
    saveTokenInfo(this.tokenFilePath, this.info)
    return this.info
  }

  private async stopLocked(): Promise<void> {
    const server = this.httpServer
    if (server === null) return
    this.httpServer = null
    this.info = null
    // Close every live session first so no SSE stream keeps the HTTP server's
    // close() waiting and no broker listener outlives the host.
    for (const session of [...this.sessions.values()]) {
      await this.closeSession(session)
    }
    this.sessions.clear()
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`)
    if (url.pathname !== MCP_PATH) {
      return json(res, 404, { error: "not_found" })
    }
    if (!isAllowedOrigin(req.headers["origin"])) {
      return json(res, 403, { error: "forbidden_origin" })
    }
    // Bearer auth is enforced on every method (POST/GET/DELETE) before any routing.
    if (!this.authorized(req)) {
      return json(res, 401, { error: "unauthorized" })
    }

    const sessionId = headerValue(req.headers[SESSION_HEADER])

    // GET (server→client SSE) and DELETE (teardown) only make sense against an
    // established session. Route them or reject as a bad request.
    if (req.method === "GET" || req.method === "DELETE") {
      const session = sessionId ? this.sessions.get(sessionId) : undefined
      if (!session) return json(res, 400, { error: "no_session" })
      this.touchSession(session)
      await session.transport.handleRequest(req, res)
      return
    }

    if (req.method !== "POST") {
      return json(res, 405, { error: "method_not_allowed" })
    }

    if (isOversizedContentLength(req.headers["content-length"], this.maxBodyBytes)) {
      req.resume()
      return json(res, 413, { error: "payload_too_large" })
    }

    let body: unknown
    try {
      body = await readJson(req, this.maxBodyBytes)
    } catch (error) {
      if (error instanceof Error && error.message === "payload_too_large") {
        return json(res, 413, { error: "payload_too_large" })
      }
      return json(res, 400, { error: "invalid_json" })
    }

    // Existing session → route the message to its retained transport.
    if (sessionId) {
      const session = this.sessions.get(sessionId)
      if (!session) return json(res, 404, { error: "unknown_session" })
      this.touchSession(session)
      await session.transport.handleRequest(req, res, body)
      return
    }

    // A sessionless `initialize` opens a stateful session; any other sessionless
    // POST is served as a stateless one-shot (the poll fallback).
    if (isInitializeRequest(body)) {
      await this.handleInitialize(req, res, body)
      return
    }
    await this.handleStateless(req, res, body)
  }

  /** Stateless one-shot: fresh server + JSON-response transport, torn down when
   *  the response closes. No session id, no subscriptions. */
  private async handleStateless(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): Promise<void> {
    const mcp = createMcpServer(this.router, this.version)
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
    res.on("close", () => {
      void transport.close()
      void mcp.close()
    })
    await mcp.connect(transport as unknown as Transport)
    await transport.handleRequest(req, res, body)
  }

  /** Open a retained, session-scoped server for an `initialize` request. */
  private async handleInitialize(req: http.IncomingMessage, res: http.ServerResponse, body: unknown): Promise<void> {
    if (this.sessions.size >= this.maxSessions) {
      return json(res, 503, { error: "too_many_sessions" })
    }

    const mcp = createMcpServer(this.router, this.version, this.broker)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      // POST replies stay plain JSON (simple clients); the separate GET SSE
      // stream still carries server→client resource-updated notifications.
      enableJsonResponse: true,
      onsessioninitialized: (id: string) => {
        this.sessions.set(id, session)
        this.touchSession(session)
      },
    })
    const session: Session = { transport, server: mcp, idleTimer: null }
    // Any teardown path (DELETE, client disconnect, our own close) removes the
    // session and clears its idle timer — no orphaned listener or transport.
    transport.onclose = () => {
      const id = transport.sessionId
      if (id !== undefined) this.sessions.delete(id)
      if (session.idleTimer) clearTimeout(session.idleTimer)
    }
    await mcp.connect(transport as unknown as Transport)
    await transport.handleRequest(req, res, body)
  }

  /** Reset a session's idle timer; on expiry the transport is closed (which
   *  removes the session via onclose). */
  private touchSession(session: Session): void {
    if (session.idleTimer) clearTimeout(session.idleTimer)
    session.idleTimer = setTimeout(() => {
      void this.closeSession(session)
    }, this.idleTimeoutMs)
    // Don't let an idle-timeout timer keep the process alive on quit.
    session.idleTimer.unref?.()
  }

  private async closeSession(session: Session): Promise<void> {
    if (session.idleTimer) {
      clearTimeout(session.idleTimer)
      session.idleTimer = null
    }
    await session.transport.close()
    await session.server.close()
  }

  private authorized(req: http.IncomingMessage): boolean {
    if (this.token === null) return false
    const header = req.headers["authorization"]
    if (typeof header !== "string" || !header.startsWith("Bearer ")) return false
    return safeEqual(header.slice("Bearer ".length), this.token)
  }
}

function listen(server: http.Server, port: number): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: Error): void => {
      server.removeListener("listening", onListening)
      reject(err)
    }
    const onListening = (): void => {
      server.removeListener("error", onError)
      const address = server.address() as AddressInfo | null
      resolve(address?.port ?? port)
    }
    server.once("error", onError)
    server.once("listening", onListening)
    server.listen(port, LOOPBACK_HOST)
  })
}

const DEFAULT_MAX_MCP_BODY_BYTES = 10 * 1024 * 1024 // 10MB

function isOversizedContentLength(value: string | undefined, maxBodyBytes: number): boolean {
  if (value === undefined) return false
  const parsed = Number(value)
  return Number.isFinite(parsed) && parsed > maxBodyBytes
}

function readJson(req: http.IncomingMessage, maxBodyBytes: number): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    let tooLarge = false
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return
      received += chunk.length
      if (received > maxBodyBytes) {
        tooLarge = true
        reject(new Error("payload_too_large"))
        return
      }
      chunks.push(chunk)
    })
    req.on("end", () => {
      if (tooLarge) return
      const raw = Buffer.concat(chunks).toString("utf8")
      if (raw.length === 0) {
        resolve(undefined)
        return
      }
      try {
        resolve(JSON.parse(raw))
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid json"))
      }
    })
    req.on("error", reject)
  })
}

/** A single header value (Node lower-cases keys; a duplicated header is an array). */
function headerValue(value: string | string[] | undefined): string | undefined {
  if (typeof value === "string" && value.length > 0) return value
  return undefined
}

/** Native MCP clients normally omit Origin; browser-like callers must be local. */
function isAllowedOrigin(origin: string | string[] | undefined): boolean {
  if (origin === undefined) return true
  if (Array.isArray(origin)) return false
  try {
    const parsed = new URL(origin)
    if (parsed.protocol === "app:" && parsed.hostname === "local" && parsed.port === "") return true
    return parsed.protocol === "http:" && (parsed.hostname === LOOPBACK_HOST || parsed.hostname === "localhost")
  } catch {
    return false
  }
}

function json(res: http.ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { "content-type": "application/json" })
  res.end(JSON.stringify(payload))
}

/** Constant-time token compare (length mismatch is an immediate miss). */
function safeEqual(provided: string, expected: string): boolean {
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(a, b)
}
