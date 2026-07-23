import http from "node:http"
import type { AddressInfo } from "node:net"
import { timingSafeEqual } from "node:crypto"
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { IpcRouter } from "../ipc/router"
import type { McpClientConfig } from "@shared/types/McpClientConfig"
import { createMcpServer } from "./server"
import { generateToken, loadToken, saveTokenInfo, type McpTokenInfo } from "./token-file"

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
}

/**
 * The opt-in loopback MCP server. Off until `start()`. Binds `127.0.0.1` only,
 * requires a static per-install bearer token on every request, and serves a fresh
 * stateless MCP server per POST (the SDK's stateless pattern — one transport per
 * request avoids cross-request id collisions).
 */
export class McpHost {
  private readonly router: IpcRouter
  private readonly tokenFilePath: string
  private readonly version: string
  private readonly preferredPort: number

  private httpServer: http.Server | null = null
  private token: string | null = null
  private info: McpTokenInfo | null = null
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
  }

  isRunning(): boolean {
    return this.httpServer !== null
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
    await new Promise<void>((resolve) => server.close(() => resolve()))
  }

  private async handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    if (!this.authorized(req)) {
      return json(res, 401, { error: "unauthorized" })
    }

    const url = new URL(req.url ?? "/", `http://${LOOPBACK_HOST}`)
    if (url.pathname !== MCP_PATH) {
      return json(res, 404, { error: "not_found" })
    }
    if (req.method !== "POST") {
      // Stateless JSON transport: the whole protocol rides on POST.
      return json(res, 405, { error: "method_not_allowed" })
    }

    let body: unknown
    try {
      body = await readJson(req)
    } catch (error) {
      if (error instanceof Error && error.message === "payload_too_large") {
        return json(res, 413, { error: "payload_too_large" })
      }
      return json(res, 400, { error: "invalid_json" })
    }

    const mcp = createMcpServer(this.router, this.version)
    // Omitting sessionIdGenerator (absent === undefined) selects stateless mode;
    // enableJsonResponse returns plain JSON so a curl/HTTP client needs no SSE parsing.
    const transport = new StreamableHTTPServerTransport({ enableJsonResponse: true })
    res.on("close", () => {
      void transport.close()
      void mcp.close()
    })
    // Cast bridges the SDK's optional-property defs vs our exactOptionalPropertyTypes;
    // StreamableHTTPServerTransport `implements Transport`, so this is type-friction, not unsafe.
    await mcp.connect(transport as unknown as Parameters<McpServer["connect"]>[0])
    await transport.handleRequest(req, res, body)
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

const MAX_MCP_BODY_BYTES = 10 * 1024 * 1024 // 10MB

function readJson(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    let tooLarge = false
    req.on("data", (chunk: Buffer) => {
      if (tooLarge) return
      received += chunk.length
      if (received > MAX_MCP_BODY_BYTES) {
        tooLarge = true
        req.destroy()
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
