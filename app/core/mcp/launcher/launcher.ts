import { spawn } from "node:child_process"
import path from "node:path"
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js"
import type { Transport } from "@modelcontextprotocol/sdk/shared/transport.js"
import {
  ErrorCode,
  LATEST_PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  isInitializeRequest,
  isJSONRPCErrorResponse,
  isJSONRPCNotification,
  isJSONRPCRequest,
  isJSONRPCResultResponse,
  type InitializeRequest,
  type InitializeResult,
  type JSONRPCMessage,
  type JSONRPCRequest,
  type RequestId,
  type Result,
} from "@modelcontextprotocol/sdk/types.js"
import { loadTokenInfo } from "../token-file"
import {
  HIDDEN_ARG,
  LOOPBACK_HOST,
  MCP_CATALOG_FILE,
  MCP_LAUNCH_FILE,
  MCP_PATH,
  MCP_TOKEN_FILE,
  readCatalog,
  readLaunchCommand,
  type McpCatalog,
} from "./contract"

export interface McpLauncherOptions {
  /** The agent's side: stdio in production, an in-memory pair in tests. */
  readonly agent: Transport
  /** The app's user-data folder, where its MCP token, catalog and launch command are. */
  readonly dataDir: string
  /** Starts the app in the tray. Defaults to the launch command the app recorded. */
  readonly startApp?: () => void
  readonly startTimeoutMs?: number
  readonly retryIntervalMs?: number
}

const DEFAULT_START_TIMEOUT_MS = 30_000
const DEFAULT_RETRY_INTERVAL_MS = 250

/** The list requests the catalog can answer, and the catalog field that answers each. */
const CATALOG_LISTS: ReadonlyMap<string, "tools" | "resources" | "resourceTemplates" | "prompts"> = new Map([
  ["tools/list", "tools"],
  ["resources/list", "resources"],
  ["resources/templates/list", "resourceTemplates"],
  ["prompts/list", "prompts"],
] as const)

const LIST_CHANGED_NOTIFICATIONS = [
  "notifications/tools/list_changed",
  "notifications/resources/list_changed",
  "notifications/prompts/list_changed",
]

/** What the app's MCP server declares; only used before the app has ever written a catalog. */
const FALLBACK_CAPABILITIES = {
  tools: { listChanged: true },
  resources: { subscribe: true, listChanged: true },
  prompts: { listChanged: true },
}

/** Ids of the launcher's own requests to the app, so their answers are not passed to the agent. */
const OWN_ID_PREFIX = "apiweave-mcp-launcher:"

/** A failure worded for the person reading the agent's output: what is wrong and what to do. */
class LauncherError extends Error {}

/** No MCP server to talk to yet: the app is not running, or its server is not listening. */
class NotListening extends Error {}

/**
 * The stdio MCP server an agent launches, standing in for the desktop app.
 *
 * An agent connects to an MCP server once, when it starts, and gives up on
 * one that is not there; the app's server lives in the app, which may not be
 * running. So the agent talks to this launcher instead, which is always there
 * because the agent started it. It answers the handshake and the tool, resource
 * and prompt lists itself, from the catalog the app wrote the last time its
 * server started, and starts the app in the tray at once. Every other message
 * goes to the app's own loopback HTTP server, unchanged, with the agent's own
 * `initialize` (so the app sees the agent's real name).
 *
 * Nothing here reads APIWeave's data: the launcher is a pipe to the one
 * process that owns it. A session the app drops — idle eviction, a restart —
 * is reopened on the next request, and the agent's resource subscriptions with
 * it.
 */
export class McpLauncher {
  private app: StreamableHTTPClientTransport | null = null
  private connecting: Promise<StreamableHTTPClientTransport> | null = null
  private initParams: InitializeRequest["params"] | null = null
  private catalog: McpCatalog | null = null
  private answeredFromCatalog = false
  private readonly subscriptions = new Set<string>()
  private readonly ownResponses = new Map<RequestId, JSONRPCMessage>()
  private ownRequestCount = 0
  private startError: Error | null = null
  private closed = false

  public constructor(private readonly options: McpLauncherOptions) {}

  public async start(): Promise<void> {
    const { agent } = this.options
    agent.onmessage = (message) => {
      void this.fromAgent(message)
    }
    agent.onclose = () => {
      void this.close()
    }
    await agent.start()
  }

  /** Ends the app session (the app keeps running) and the agent's side. */
  public async close(): Promise<void> {
    if (this.closed) return
    this.closed = true
    const app = this.app
    this.app = null
    if (app !== null) {
      await app.terminateSession().catch(() => undefined)
      await app.close()
    }
    await this.options.agent.close()
  }

  private async fromAgent(message: JSONRPCMessage): Promise<void> {
    if (isJSONRPCRequest(message)) {
      await this.fromAgentRequest(message)
      return
    }
    // The launcher sends its own `initialized` when it opens the app session.
    if (isJSONRPCNotification(message) && message.method === "notifications/initialized") return
    // Any other notification, or the answer to a request the app sent the agent.
    // Before the app is reached there is nothing for either to refer to.
    void this.app?.send(message).catch(() => undefined)
  }

  private async fromAgentRequest(request: JSONRPCRequest): Promise<void> {
    if (isInitializeRequest(request)) {
      this.initParams = request.params
      this.reply(request.id, this.initializeResult(request.params.protocolVersion))
      // Start the app now, so it is up by the agent's first call.
      this.connectInBackground()
      return
    }
    if (request.method === "ping") {
      this.reply(request.id, {})
      return
    }
    const list = CATALOG_LISTS.get(request.method)
    const catalog = list !== undefined && this.app === null ? this.loadCatalog() : null
    if (list !== undefined && catalog !== null) {
      this.answeredFromCatalog = true
      this.connectInBackground()
      this.reply(request.id, catalog[list])
      return
    }
    try {
      await this.forward(request)
      this.trackSubscription(request)
    } catch (error) {
      this.replyFailure(request, error)
    }
  }

  private initializeResult(requested: string): InitializeResult {
    const catalog = this.loadCatalog()
    return {
      protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : LATEST_PROTOCOL_VERSION,
      capabilities: catalog?.capabilities ?? FALLBACK_CAPABILITIES,
      serverInfo: catalog?.serverInfo ?? { name: "APIWeave", version: "0.0.0" },
      ...(catalog?.instructions === undefined ? {} : { instructions: catalog.instructions }),
    }
  }

  private loadCatalog(): McpCatalog | null {
    this.catalog ??= readCatalog(path.join(this.options.dataDir, MCP_CATALOG_FILE))
    return this.catalog
  }

  /**
   * Send one request to the app, retrying once on a fresh session when the
   * old one is gone. A connection dropped mid-request may still have run the
   * request, so that is retried only for one safe to run twice; a write is
   * not, and the agent is told instead.
   */
  private async forward(request: JSONRPCRequest): Promise<void> {
    const app = await this.connectApp()
    try {
      await app.send(request)
    } catch (error) {
      const failure = sendFailure(error)
      if (failure === "other") throw error
      if (failure === "dropped" && !this.safeToRepeat(request)) {
        this.dropApp(app)
        throw new LauncherError(
          "APIWeave closed the connection during this call, so it may or may not have run. Check before trying it again.",
        )
      }
      this.dropApp(app)
      await (await this.connectApp()).send(request)
    }
  }

  /** Anything but a tool call only reads; a tool call is safe again only if the app marks the tool read-only. */
  private safeToRepeat(request: JSONRPCRequest): boolean {
    if (request.method !== "tools/call") return true
    const name = request.params?.["name"]
    const tool = this.loadCatalog()?.tools.tools.find((candidate) => candidate.name === name)
    return tool?.annotations?.readOnlyHint === true
  }

  private trackSubscription(request: JSONRPCRequest): void {
    const uri = request.params?.["uri"]
    if (typeof uri !== "string") return
    if (request.method === "resources/subscribe") this.subscriptions.add(uri)
    if (request.method === "resources/unsubscribe") this.subscriptions.delete(uri)
  }

  private connectInBackground(): void {
    // A failure here is reported by whichever request needs the app next.
    this.connectApp().catch(() => undefined)
  }

  private connectApp(): Promise<StreamableHTTPClientTransport> {
    if (this.app !== null) return Promise.resolve(this.app)
    this.connecting ??= this.reachApp().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  /** Open a session with the running app, or start the app and wait for its server. */
  private async reachApp(): Promise<StreamableHTTPClientTransport> {
    const first = await this.tryOpenSession()
    if (first !== null) return first
    this.startApp()
    const timeoutMs = this.options.startTimeoutMs ?? DEFAULT_START_TIMEOUT_MS
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      await delay(this.options.retryIntervalMs ?? DEFAULT_RETRY_INTERVAL_MS)
      if (this.closed) throw new LauncherError("The MCP launcher was closed.")
      if (this.startError !== null) {
        throw new LauncherError(
          `APIWeave could not be started (${this.startError.message}). Open it once yourself so it records where it is installed.`,
        )
      }
      const app = await this.tryOpenSession()
      if (app !== null) return app
    }
    throw new LauncherError(
      `APIWeave did not start its MCP server within ${Math.round(timeoutMs / 1000)} seconds. ` +
        "Open APIWeave and check that Settings → MCP Server is on.",
    )
  }

  /** A session, or null when nothing is listening yet. Any other failure is thrown, worded for the user. */
  private async tryOpenSession(): Promise<StreamableHTTPClientTransport | null> {
    try {
      return await this.openSession()
    } catch (error) {
      if (error instanceof NotListening || isNetworkFailure(error)) return null
      if (error instanceof LauncherError) throw error
      throw new LauncherError(`APIWeave's MCP server refused the connection: ${errorMessage(error)}`)
    }
  }

  private async openSession(): Promise<StreamableHTTPClientTransport> {
    const info = loadTokenInfo(path.join(this.options.dataDir, MCP_TOKEN_FILE))
    if (info === null) throw new NotListening()
    const app = new StreamableHTTPClientTransport(new URL(`http://${LOOPBACK_HOST}:${info.port}${MCP_PATH}`), {
      requestInit: { headers: { Authorization: `Bearer ${info.token}` } },
    })
    app.onmessage = (message) => this.fromApp(message)
    // Failures surface through `send`; the transport reports them here as well.
    app.onerror = () => undefined
    app.onclose = () => {
      if (this.app === app) this.app = null
    }
    await app.start()
    try {
      const init = await this.ownRequest<InitializeResult>(app, "initialize", this.initParams ?? {
        protocolVersion: LATEST_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: "APIWeave MCP launcher", version: "1" },
      })
      app.setProtocolVersion(init.protocolVersion)
      await app.send({ jsonrpc: "2.0", method: "notifications/initialized" })
      for (const uri of this.subscriptions) await this.ownRequest(app, "resources/subscribe", { uri })
    } catch (error) {
      await app.close()
      throw error
    }
    if (this.closed) {
      await app.close()
      throw new LauncherError("The MCP launcher was closed.")
    }
    this.app = app
    // The app rewrote its catalog as its server started; read that one next time.
    this.catalog = null
    if (this.answeredFromCatalog) {
      // The lists came from a file, which an update may have made stale: let the agent re-read them.
      this.answeredFromCatalog = false
      for (const method of LIST_CHANGED_NOTIFICATIONS) void this.options.agent.send({ jsonrpc: "2.0", method })
    }
    return app
  }

  /** A request of the launcher's own; the app answers it inside `send`, since its server replies with JSON. */
  private async ownRequest<T extends Result>(
    app: StreamableHTTPClientTransport,
    method: string,
    params: Record<string, unknown>,
  ): Promise<T> {
    const id = `${OWN_ID_PREFIX}${++this.ownRequestCount}`
    await app.send({ jsonrpc: "2.0", id, method, params })
    const response = this.ownResponses.get(id)
    this.ownResponses.delete(id)
    if (response !== undefined && isJSONRPCResultResponse(response)) return response.result as T
    if (response !== undefined && isJSONRPCErrorResponse(response)) {
      throw new LauncherError(`APIWeave refused ${method}: ${response.error.message}`)
    }
    throw new LauncherError(`APIWeave did not answer ${method}.`)
  }

  private fromApp(message: JSONRPCMessage): void {
    const isResponse = isJSONRPCResultResponse(message) || isJSONRPCErrorResponse(message)
    if (isResponse && typeof message.id === "string" && message.id.startsWith(OWN_ID_PREFIX)) {
      this.ownResponses.set(message.id, message)
      return
    }
    void this.options.agent.send(message).catch(() => undefined)
  }

  private dropApp(app: StreamableHTTPClientTransport): void {
    if (this.app === app) this.app = null
    void app.close()
  }

  private startApp(): void {
    if (this.options.startApp !== undefined) {
      this.options.startApp()
      return
    }
    const launch = readLaunchCommand(path.join(this.options.dataDir, MCP_LAUNCH_FILE))
    if (launch === null) {
      throw new LauncherError(
        "APIWeave has not been opened on this computer yet, so it cannot be started from here. " +
          "Open APIWeave once and turn on Settings → MCP Server.",
      )
    }
    // An agent that is itself an Electron app can leave this set, and it would
    // start APIWeave as plain Node.
    const env = { ...process.env }
    delete env["ELECTRON_RUN_AS_NODE"]
    this.startError = null
    const child = spawn(launch.command, [...launch.args, HIDDEN_ARG], { detached: true, stdio: "ignore", env })
    child.once("error", (error) => {
      this.startError = error
    })
    child.unref()
  }

  private reply(id: RequestId, result: Result): void {
    void this.options.agent.send({ jsonrpc: "2.0", id, result })
  }

  /** A failed tool call is a tool result the agent shows; anything else is a JSON-RPC error. */
  private replyFailure(request: JSONRPCRequest, error: unknown): void {
    const text = error instanceof LauncherError ? error.message : `APIWeave did not answer: ${errorMessage(error)}`
    if (request.method === "tools/call") {
      this.reply(request.id, { content: [{ type: "text", text }], isError: true })
      return
    }
    void this.options.agent.send({ jsonrpc: "2.0", id: request.id, error: { code: ErrorCode.InternalError, message: text } })
  }
}

/**
 * Why a send failed: `unseen` — the app certainly never saw the request (its
 * session was gone, or nothing accepted the connection); `dropped` — the
 * connection broke after it was sent, so it may have run; `other` — anything
 * else, reported as it is.
 */
function sendFailure(error: unknown): "unseen" | "dropped" | "other" {
  if (error instanceof StreamableHTTPError) return error.code === 404 ? "unseen" : "other"
  const code = causeCode(error)
  if (code === "ECONNREFUSED") return "unseen"
  return code === undefined ? "other" : "dropped"
}

/** `fetch` failing below HTTP: nothing listening, or the app going away mid-connect. */
function isNetworkFailure(error: unknown): boolean {
  return error instanceof TypeError && causeCode(error) !== undefined
}

function causeCode(error: unknown): string | undefined {
  for (let current: unknown = error; current instanceof Error; current = current.cause) {
    const code = (current as NodeJS.ErrnoException).code
    if (typeof code === "string") return code
  }
  return undefined
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
