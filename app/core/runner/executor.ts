import { AsyncLocalStorage } from "node:async_hooks"
import fs from "node:fs/promises"
import type { ClockProvider, RngProvider } from "./harness/providers"
import { FormData as UndiciFormData, Response as UndiciResponse, type RequestInit as UndiciRequestInit } from "undici"
import { DynamicFunctions } from "./dynamic_functions"
import { CookieJar } from "tough-cookie"
import { SafeHttp, SafeUrlError, describeNetworkError } from "./safe_http"
import { OAuthError, oauthAccessToken, type OAuthTokenCache } from "./oauth"
import { AuthError } from "./auth_error"
import { signAwsSigV4 } from "./aws_sigv4"
import { digestAuthorization, parseDigestChallenge } from "./digest_auth"
import { signJwt } from "./jwt"
import { toHeaderRecord } from "./safe_http"
import { StreamHandshakeError, collectStreamMessages, type StreamAdapter, type StreamMessage } from "./stream_listener"
import { SseAdapter } from "./streams/sse"
import { WebsocketAdapter, type WebsocketMessageToSend } from "./streams/websocket"
import { callUnary, loadGrpcSchema, type GrpcConnection, type GrpcSchemaSource } from "./grpc"
import { GrpcStreamAdapter } from "./streams/grpc"
import { GrpcSchemaError } from "./grpc_schema"
import { runScript, type ScriptRequest, type ScriptResponse, type ScriptRunResult } from "./script_sandbox"
import { RegexSandbox } from "./regex_sandbox"
import { compileSchema, MAX_SCHEMA_VIOLATIONS, schemaViolations } from "./json_schema"
import type { Validator } from "@cfworker/json-schema"
import { ASSERTION_VALUE_TYPES, parseSchemaValue } from "@shared/analysis/assertion_expected"
import type { SchemaViolation } from "@shared/types/SchemaViolation"
import { SECRET_PLACEHOLDER, extractSecretRefsFromString, scriptSecretNames } from "../services/secret_utils"
import type { ResumeSeed } from "./resume"
import { SIDE_TABLE_THRESHOLD_BYTES } from "../db"
import type { RunEvent } from "@shared/types/RunProgressEvent"
import type { RunnerNodeStatus } from "@shared/types/RunnerNodeStatus"
import type { RunResult } from "@shared/types/RunResult"
import type { JsonValue } from "@shared/types/JsonValue"
import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation"
import type { AssertionOperator } from "@shared/types/AssertionOperator"
import type { AssertionSource } from "@shared/types/AssertionSource"
import type { ContractMode } from "@shared/types/ContractMode"
import type { ExtractorOutcome } from "@shared/types/ExtractorOutcome"
import type { ExtractorResolution } from "@shared/types/ExtractorResolution"
import type { HttpAttempt } from "@shared/types/HttpAttempt"
import type { HttpRetryConfig } from "@shared/types/HttpRetryConfig"
import type { OAuth2AuthConfig } from "@shared/types/OAuth2AuthConfig"
import type { AwsSigV4AuthConfig } from "@shared/types/AwsSigV4AuthConfig"
import type { DigestAuthConfig } from "@shared/types/DigestAuthConfig"
import type { JwtAuthConfig } from "@shared/types/JwtAuthConfig"
import type { HttpScriptsConfig } from "@shared/types/HttpScriptsConfig"
import type { GraphqlBody } from "@shared/types/GraphqlBody"
import type { JsonrpcBody } from "@shared/types/JsonrpcBody"
import type { ScriptOutcome } from "@shared/types/ScriptOutcome"
import { DEFAULT_SCRIPT_TIMEOUT_MS } from "@shared/zod-schemas/HttpScriptsConfigSchema"
import { WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY, WORKFLOW_CALL_FOR_EACH_MAX_ITERATIONS } from "@shared/zod-schemas/WorkflowCallForEachSchema"
import { isQueryPath, resolveExtractorPath } from "@shared/extractors/extractorPath"
import { findSoapFault } from "@shared/extractors/xmlDocument"
import type { SoapBody } from "@shared/types/SoapBody"
import type { SoapFault } from "@shared/types/SoapFault"
import { findCycles, successorMap } from "@shared/analysis/workflow_graph_analyzer"
import type { JsonValueType } from "@shared/types/JsonValueType"
import type { StreamFinishCondition } from "@shared/types/StreamFinishCondition"

/**
 * Workflow executor.
 *
 * Processes workflow nodes in graph order, resolves templates, executes HTTP requests,
 * evaluates assertions, handles delays and merge nodes, and writes field-level updates.
 * Emits `node.status` events for the renderer.
 */

// -------------------- Types --------------------

export interface WorkflowNode {
  readonly nodeId: string
  readonly type: "http-request" | "sse" | "websocket" | "grpc" | "assertion" | "delay" | "merge" | "start" | "end" | "workflow"
  readonly label?: string | null
  readonly config?: Record<string, unknown>
}

export interface WorkflowEdge {
  readonly edgeId: string
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

export interface WorkflowGraph {
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
  readonly variables?: Readonly<Record<string, unknown>>
}

// -------------------- HTTP request config shapes --------------------
// Mirrors HTTPNodeDataSchema (shared/zod-schemas/HTTPNodeDataSchema.ts) — the
// panel writes this shape into node.config; the executor must consume it.

interface HttpAuthConfig {
  readonly type?: "none" | "bearer" | "basic" | "apiKey" | "oauth2" | "awsSigV4" | "digest" | "jwt"
  readonly bearer?: { readonly token?: string }
  readonly basic?: { readonly username?: string; readonly password?: string }
  readonly apiKey?: { readonly key?: string; readonly value?: string; readonly addTo?: "header" | "query" }
  readonly oauth2?: OAuth2AuthConfig
  readonly awsSigV4?: AwsSigV4AuthConfig
  readonly digest?: DigestAuthConfig
  readonly jwt?: JwtAuthConfig
}

/** How a request reaches the token endpoint: the node's own deadline, cancel and TLS settings. */
interface AuthRequestContext {
  readonly signal: AbortSignal | undefined
  readonly timeoutMs: number
  readonly sslVerify: boolean
  /** Skip the cached token: the last one was answered with a 401. */
  readonly forceRefresh: boolean
}

const SECRET_REFERENCE = /^\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}$/

/** The NAME of a whole `{{secrets.NAME}}` reference, the only form an auth secret field holds. */
function secretNameOf(reference: string | undefined): string | undefined {
  return reference ? SECRET_REFERENCE.exec(reference)?.[1] : undefined
}

interface FormDataEntryLike {
  readonly key: string
  readonly value: string
  readonly type: "text" | "file"
  readonly active?: boolean
}

interface FileUploadLike {
  readonly type: "path" | "base64" | "variable"
  readonly value: string
  readonly mimeType?: string
}

/** A target workflow as seen by a Call Workflow node — structural fields only, no run history. */
export interface ResolvedSubWorkflow {
  readonly name?: string | null
  readonly nodes: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
  readonly variables?: Readonly<Record<string, unknown>>
}

/** The Call Workflow node's config, as the executor reads it. */
interface WorkflowCallConfig {
  readonly targetWorkflowId?: string | null
  readonly inputMapping?: Record<string, string>
  readonly outputMapping?: Record<string, string>
  readonly forEach?: WorkflowCallForEachConfig
}

/** The `forEach` slice of a Call Workflow node's config (see `WorkflowCallForEachSchema`). */
interface WorkflowCallForEachConfig {
  readonly items?: string
  readonly itemVariable?: string
  readonly indexVariable?: string
  readonly concurrency?: number
  readonly stopOnFailure?: boolean
}

/** One iteration's result, indexed by item position so concurrent runs stay ordered. */
interface ForEachIterationOutcome {
  readonly index: number
  readonly status: ExecutorOutput["status"]
  readonly output: ExecutorOutput
  readonly runId?: string
}

export interface ExecutorDeps {
  readonly clock: ClockProvider
  readonly rng: RngProvider
  readonly http: SafeHttp
  readonly functions: DynamicFunctions
  readonly baseUrl?: string
  readonly secrets?: Readonly<Record<string, string>>
  readonly environmentVariables?: Readonly<Record<string, unknown>>
  /**
   * Overrides every node's `contract` setting for the run (the CLI's
   * `--contract` flag). Absent: each node's own setting, defaulting to `fail`
   * when it has OpenAPI metadata and `off` otherwise.
   */
  readonly contract?: ContractMode
  /** The data row of a data-driven run's iteration, read as `{{data.<column>}}`. */
  readonly data?: Readonly<Record<string, unknown>>
  readonly emitProgress?: (event: ExecutorProgressEvent) => void
  /**
   * The run's cookie jar: cookies a response sets are sent by later requests
   * of the same run. Absent: per executor. A Call Workflow child always shares
   * its caller's, so a login sub-workflow leaves the caller signed in.
   */
  readonly cookieJar?: CookieJar
  /** OAuth 2.0 tokens fetched so far — shared across runs when the caller keeps one. Absent: per executor. */
  readonly oauthTokens?: OAuthTokenCache
  /** Adds a value the run obtained itself (an OAuth token) to what its masker scrubs. */
  readonly maskValue?: (value: string) => void
  /** Writes a refreshed OAuth token set back to the secret it was read from. */
  readonly saveSecret?: (name: string, value: string) => Promise<void>
  /** Workspace-scoped workflow lookup for `type: "workflow"` nodes. Undefined disables the node type entirely. */
  readonly resolveWorkflow?: (workflowId: string) => ResolvedSubWorkflow | undefined
  /**
   * Persists a Call Workflow sub-execution as its own run row against the
   * target workflow, so the callee's History has something to investigate when
   * the call fails. `begin` returns the deps the child executor must use — its
   * progress is recorded against the child run, not the caller's. `finish` runs
   * exactly once per `begin`, with `undefined` when the sub-execution threw.
   * Undefined dep keeps the old inline-only behaviour (harness, CLI, tests).
   */
  readonly subRun?: {
    begin(workflowId: string): { readonly runId: string; readonly deps: ExecutorDeps }
    finish(runId: string, output: ExecutorOutput | undefined): void
  }
}

const PLACEHOLDER_RE = /\{\{([^}]+)\}\}/g

/**
 * Substitute placeholders in a JSON template. A placeholder inside a string
 * literal (`"name": "{{variables.name}}"`) has its value JSON-string-escaped,
 * so a `"`, `\` or newline in a variable or secret cannot break the body. One
 * standing alone as a value (`"id": {{variables.id}}`) is inserted raw, so it
 * can supply a number or a boolean.
 *
 * Only the literal text between placeholders moves the in-string state: a
 * placeholder's own text (`{{randomChoice("a,b")}}`) never toggles it.
 */
function substituteJsonTemplate(text: string, resolve: (match: string, rawPath: string) => string): string {
  let out = ""
  let inString = false
  let escaped = false
  let last = 0
  for (const placeholder of text.matchAll(PLACEHOLDER_RE)) {
    const literal = text.slice(last, placeholder.index)
    for (const ch of literal) {
      if (escaped) escaped = false
      else if (ch === "\\") escaped = inString
      else if (ch === '"') inString = !inString
    }
    escaped = false
    const value = resolve(placeholder[0], placeholder[1]!)
    out += literal + (inString ? JSON.stringify(value).slice(1, -1) : value)
    last = placeholder.index + placeholder[0].length
  }
  return out + text.slice(last)
}

/**
 * The text a resolved placeholder becomes. An object or array is written as
 * JSON — in a JSON template a standalone placeholder then inserts it as a
 * value, and one inside a string literal gets the JSON text escaped — never
 * as `[object Object]`.
 */
function placeholderText(value: unknown): string {
  return typeof value === "object" && value !== null ? JSON.stringify(value) : String(value)
}

function hasJsonContentType(headers: Readonly<Record<string, string>>): boolean {
  return Object.entries(headers).some(([name, value]) => name.toLowerCase() === "content-type" && /\bjson\b/i.test(value))
}

/** Node types that ride the two-phase (Ready / Complete) stream-listener lifecycle. */
const STREAM_NODE_TYPES: ReadonlySet<string> = new Set(["sse", "websocket", "grpc"])

/** Node types whose result an assertion or merge branch can read as a response. */
const RESPONSE_NODE_TYPES: ReadonlySet<string> = new Set(["http-request", "sse", "websocket", "grpc"])

type KeyValueRows = ReadonlyArray<{ readonly key: string; readonly value: string; readonly active?: boolean }> | undefined

/** One WebSocket message a node sends after the handshake, as stored in its config. */
interface WebsocketOutboundConfig {
  readonly data: string
  readonly type?: "text" | "binary"
  readonly delayMs?: number
}

/** A gRPC call's fully resolved request, shared by the unary call and the server-streaming adapter. */
interface GrpcCall {
  readonly connection: GrpcConnection
  readonly source: GrpcSchemaSource
  readonly service: string
  readonly method: string
  readonly message: unknown
  readonly metadata: Readonly<Record<string, string>>
  readonly deadlineMs: number
  readonly target: string
  readonly rpc: string
  readonly unresolvedPlaceholders: readonly string[]
}

/** A stream node's request, ready to open: the adapter plus what the shared lifecycle needs around it. */
interface PreparedStream {
  readonly adapter: StreamAdapter
  /** Request facts echoed on the node result (gRPC adds `target` and `rpc`). */
  readonly request: { readonly method: string; readonly url: string; readonly [key: string]: unknown }
  readonly maxMessages: number
  readonly finishConditions: readonly StreamFinishCondition[]
  readonly extractors: Record<string, string> | undefined
  readonly unresolvedPlaceholders: readonly string[]
}

/** A readable cause for a stream failure: a blocked URL, a network error, or the error itself. */
function streamErrorText(error: unknown, url: string): string {
  return error instanceof SafeUrlError || error instanceof StreamHandshakeError
    ? error.message
    : (describeNetworkError(error, url) ?? String(error))
}

/**
 * Whether a node is driven by the two-phase stream lifecycle rather than a
 * single call. gRPC is both: a unary call is one result, a server-streaming
 * call is a stream, chosen by the node's `callType`.
 */
function isStreamNode(node: WorkflowNode): boolean {
  if (!STREAM_NODE_TYPES.has(node.type)) return false
  return node.type !== "grpc" || node.config?.["callType"] === "server-streaming"
}

function isResponseNodeType(type: string | undefined): boolean {
  return type !== undefined && RESPONSE_NODE_TYPES.has(type)
}

/**
 * The body as text, or null when it is binary (stored base64). A textual
 * Content-Type (text/*, JSON, XML, form) is always text, decoded with its
 * declared charset or lossily as UTF-8; any other type is text only when it is
 * valid UTF-8. A sequence cut off by truncation is fine.
 */
function decodeBody(bytes: Buffer, contentType: string, truncated: boolean): string | null {
  const [mime = "", ...params] = contentType.toLowerCase().split(";").map((part) => part.trim())
  if (/^text\/|[/+](json|xml)$|^application\/x-www-form-urlencoded$/.test(mime)) {
    const charset = params.find((param) => param.startsWith("charset="))?.slice("charset=".length).replace(/"/g, "")
    let decoder: TextDecoder
    try {
      decoder = new TextDecoder(charset || "utf-8")
    } catch {
      decoder = new TextDecoder("utf-8")
    }
    return decoder.decode(bytes, { stream: truncated })
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes, { stream: truncated })
  } catch {
    return null
  }
}

function appendQueryParams(url: string, queryParams: Readonly<Record<string, string>>): string {
  if (Object.keys(queryParams).length === 0) return url
  const [base = url, existingQuery] = url.split("?")
  const params = new URLSearchParams(existingQuery ?? "")
  for (const [key, value] of Object.entries(queryParams)) params.set(key, value)
  return `${base}?${params.toString()}`
}

/** Internal terminal-node event. The scheduler persists it but never relays its body over progress transports. */
export interface NodeResultEvent {
  readonly kind: "node.result"
  readonly runId: string
  readonly nodeId: string
  readonly result: RunResult
}

export type ExecutorProgressEvent = RunEvent | NodeResultEvent

export interface ExecuteOptions {
  readonly runId?: string
  readonly startNodeIds?: readonly string[]
  readonly cancelSignal?: AbortSignal
  /** A rerun: what the source run already settled. `startNodeIds` are its entries. */
  readonly resume?: ResumeSeed
}

/** How every refusal to read a rerun's seeded value starts; the scheduler passes it through to history. */
export const RERUN_REFUSED = "Not rerun:"

export interface NodeResult {
  readonly status: string
  readonly statusCode?: number
  /** Configured `expectedStatus` echoed back so a matched negative test (e.g. a green 409) is legible in the run snapshot. */
  readonly expectedStatus?: number | readonly number[]
  readonly body?: unknown
  readonly headers?: Record<string, string>
  readonly duration?: number
  readonly error?: string
  readonly assertionOutcome?: "pass" | "fail"
  readonly message?: string
  readonly type?: string
  readonly response?: {
    readonly body: unknown
    readonly headers: Record<string, string>
    readonly statusCode: number
    /** gRPC only: the status code name (`OK`, `NOT_FOUND`), its message and the trailing metadata. */
    readonly status?: string
    readonly statusMessage?: string
    readonly trailers?: Record<string, string>
    /** The body is the first SIDE_TABLE_THRESHOLD_BYTES bytes only. */
    readonly truncated?: boolean
    /** The body is not UTF-8 text and is stored base64-encoded. */
    readonly bodyEncoding?: "base64"
    /** Full body size, when known (always, unless truncated without an unencoded Content-Length). */
    readonly responseSizeBytes?: number
    /** Stream nodes: milliseconds from open to close. */
    readonly duration?: number
  }
  readonly mergedByOther?: boolean
  readonly startedAt?: string
  readonly completedAt?: string
  readonly secretRefs?: readonly string[]
  readonly unresolvedPlaceholders?: readonly string[]
  readonly assertionEvaluations?: readonly AssertionEvaluation[]
  readonly extractorOutcomes?: readonly ExtractorOutcome[]
  /** Every request a retrying http-request node sent; the rest of the result is the last one's. */
  readonly attempts?: readonly HttpAttempt[]
  /** What the node's pre-request and post-response scripts did, in the order they ran. */
  readonly scripts?: readonly ScriptOutcome[]
  /** Summary only — never the sub-workflow's raw per-node results, which would bypass the top-level redaction pass. */
  readonly subWorkflow?: {
    readonly workflowId: string
    /** The sub-execution's own run row, when one was persisted — the callee's History entry for this call. */
    readonly runId?: string
    readonly status: ExecutorOutput["status"]
    readonly nodeCount: number
    readonly failedNodeCount: number
    readonly outputVariableNames: readonly string[]
    /** Present only when the node ran with `forEach`: one entry per iteration, in item order. */
    readonly forEach?: {
      /** The number of items resolved (after the iteration cap). */
      readonly itemCount: number
      /** The number of iterations actually started — fewer than `itemCount` when the node stopped early or was cancelled. */
      readonly ranCount: number
      /** The number of iterations that failed. */
      readonly failedCount: number
      readonly iterations: readonly {
        readonly index: number
        readonly runId?: string
        readonly status: ExecutorOutput["status"]
      }[]
    }
  }
  readonly [key: string]: unknown
}

export interface ExecutorOutput {
  readonly caseName?: string
  /** `cancelled` whenever the run's cancel signal fired, whatever the nodes did before it. */
  readonly status: "passed" | "failed" | "cancelled"
  readonly startedAt: string
  readonly seed?: string
  readonly nodeStatuses: Readonly<Record<string, RunnerNodeStatus>>
  readonly extractedVariables: Readonly<Record<string, unknown>>
  readonly outputs: Readonly<Record<string, unknown>>
  readonly results: readonly RunResult[]
  readonly failedNodes: readonly string[]
  readonly failureMessage: string | null
}

type AssertionResponseSource =
  | { readonly state: "resolved"; readonly nodeId: string; readonly result: NodeResult }
  | { readonly state: "source-unavailable" | "ambiguous-source" }

/** Resolves `true` after `ms`, or `false` as soon as `signal` aborts (at once if it already has). */
function waitFor(ms: number, signal: AbortSignal | undefined): Promise<boolean> {
  if (signal?.aborted) return Promise.resolve(false)
  return new Promise((resolve) => {
    const onAbort = (): void => {
      clearTimeout(timer)
      resolve(false)
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort)
      resolve(true)
    }, ms)
    signal?.addEventListener("abort", onAbort, { once: true })
  })
}

/** One attempt as `attempts` lists it. */
function toHttpAttempt(attempt: NodeResult): HttpAttempt {
  return {
    ...(attempt.statusCode !== undefined ? { statusCode: attempt.statusCode } : {}),
    duration: Math.max(0, Math.round(attempt.duration ?? 0)),
    ...(typeof attempt.error === "string" ? { error: attempt.error } : {}),
  }
}

/** The node's error once the last attempt failed; `hasCondition` is whether `until` set the bar. */
function retryExhaustedError(attempt: NodeResult, attemptCount: number, hasCondition: boolean): string {
  const verdict = hasCondition ? "Condition not met" : "Failed"
  const cause = attempt.error ?? (hasCondition ? undefined : `HTTP ${attempt.statusCode}`)
  return `${verdict} after ${attemptCount} attempts${cause ? `: ${cause}` : ""}`
}

/** The wait after attempt number `attempt` (1-based): `intervalMs`, doubled per attempt when exponential, capped by `maxIntervalMs`. */
export function retryDelayMs(retry: HttpRetryConfig, attempt: number): number {
  const base = retry.backoff === "exponential" ? retry.intervalMs * 2 ** (attempt - 1) : retry.intervalMs
  return Math.min(base, retry.maxIntervalMs ?? Number.POSITIVE_INFINITY)
}

/**
 * The failure message for a JSON-RPC response that carries an `error` member,
 * or `undefined` when it does not. Per JSON-RPC 2.0 the error is an object
 * with a `code` and a `message`; both are read leniently so a malformed error
 * still fails the node rather than passing through.
 */
/** The node's failure message for a SOAP Fault: its code and reason, whichever the version supplied. */
function soapFaultText(fault: SoapFault): string {
  const code = fault.code === undefined ? "" : ` ${fault.code}`
  const reason = fault.reason === undefined ? "" : `: ${fault.reason}`
  return `SOAP Fault${code}${reason}`
}

function jsonRpcErrorFailure(body: unknown): string | undefined {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return undefined
  const record = body as Record<string, unknown>
  if (!("error" in record)) return undefined
  const error = record["error"]
  if (typeof error !== "object" || error === null || Array.isArray(error)) return "JSON-RPC error"
  const { code, message } = error as Record<string, unknown>
  const codeText = code === undefined ? "" : ` ${String(code)}`
  const messageText =
    message === undefined || message === "" ? "" : `: ${typeof message === "string" ? message : JSON.stringify(message)}`
  return `JSON-RPC error${codeText}${messageText}`
}

// -------------------- Internal sentinel --------------------

class StopBranch extends Error {
  public constructor(message: string) {
    super(message)
    this.name = "StopBranch"
  }
}

// -------------------- Executor --------------------


export class WorkflowExecutor {
  private readonly results = new Map<string, NodeResult>()
  private readonly workflowVariables: Record<string, unknown> = {}
  private readonly environmentVariables: Record<string, unknown>
  private readonly nodeStatuses = new Map<string, RunnerNodeStatus>()
  private readonly failedNodes = new Set<string>()
  private hasFailures = false
  private firstErrorMessage: string | null = null
  private readonly branchResults = new Map<string, ReadonlyArray<readonly [string, NodeResult]>>()
  private currentBranchContext: ReadonlyArray<readonly [string, NodeResult]> = []
  private readonly mergeCompleted = new Set<string>()
  /**
   * One traversal per node per run, keyed by node id. The handle resolves with
   * that traversal's outcome (never rejects) so a second path into the node can
   * join it. See `executeFromNode`.
   */
  private readonly nodeRuns = new Map<string, Promise<unknown>>()
  /** Background stream consumers which own connections after the Ready path has started. */
  private readonly streamListeners = new Map<string, AbortController>()
  private readonly streamTasks = new Set<Promise<void>>()
  private workflowNodes = new Map<string, WorkflowNode>()
  private activeRunId = "harness"
  private cancelSignal: AbortSignal | undefined
  // Set by a parent executor on a child it creates for a Call Workflow node.
  // Bounds recursion regardless of write-time cycle validation — a cycle
  // introduced by editing the target workflow after the caller was saved
  // still can't hang or stack-overflow a run.
  private callDepth = 0
  private static readonly MAX_CALL_DEPTH = 8
  /** The next JSON-RPC request id, incremented per request within a run. */
  private rpcId = 0
  private readonly oauthTokens: OAuthTokenCache
  private readonly cookieJar: CookieJar
  /** Loaded on the first rule that needs it (see `prepareRules`); `matches` and `matchesSchema` are synchronous after that. */
  private regex: RegexSandbox | null = null
  /** Compiled "matchesSchema" schemas, keyed by the configured value: a polling node compiles its schema once. */
  private readonly schemaValidators = new Map<unknown, Validator>()
  /** On a rerun, the nodes it executes; every other node holds the source run's result. */
  private resumeScope: ReadonlySet<string> | null = null
  /** Nodes whose result was seeded from the source run rather than produced here. */
  private readonly seededNodeIds = new Set<string>()
  /** Source-run variables that were stored masked, so were not seeded. */
  private readonly maskedSeedVariables = new Set<string>()
  /** On a rerun, the nodes it starts at. */
  private resumeEntryIds: ReadonlySet<string> = new Set()
  /**
   * `{{prev}}` for the node executing in this async context: a rerun entry's
   * seeded predecessor (`null` when it has none, see `seededPrev`); `undefined`
   * for every other node, which reads the latest result.
   */
  private readonly entryPrev = new AsyncLocalStorage<readonly [string, NodeResult] | null | undefined>()

  public constructor(private readonly deps: ExecutorDeps) {
    this.environmentVariables = { ...(deps.environmentVariables ?? {}) }
    this.oauthTokens = deps.oauthTokens ?? new Map()
    this.cookieJar = deps.cookieJar ?? new CookieJar()
  }

  public async executeWorkflow(
    workflow: WorkflowGraph,
    options: ExecuteOptions = {},
    caseName?: string,
    seed?: string,
  ): Promise<ExecutorOutput> {
    const startedAt = this.deps.clock.isoNow()
    this.activeRunId = options.runId ?? "harness"
    this.cancelSignal = options.cancelSignal

    if (workflow.variables) {
      for (const [key, value] of Object.entries(workflow.variables)) {
        this.workflowVariables[key] = value
      }
    }

    this.hasFailures = false
    this.firstErrorMessage = null

    const nodes = new Map<string, WorkflowNode>()
    for (const node of workflow.nodes) {
      nodes.set(node.nodeId, node)
    }
    this.workflowNodes = nodes
    const edges = workflow.edges

    // Per-run: a handle left over from a previous run would make every node on
    // that path look already-executed.
    this.nodeRuns.clear()
    this.streamListeners.clear()
    this.streamTasks.clear()
    this.rpcId = 0
    if (options.resume) this.seedResume(options.resume, nodes, edges)

    // Workflows have no loops: a cycle would send its requests until something
    // gave out. The canvas refuses to draw one, and a graph that has one anyway
    // (edited over MCP or in the JSON editor) fails here before any request.
    const cycle = findCycles(successorMap(edges))[0]
    if (cycle) {
      const names = [...cycle, cycle[0]!].map((id) => nodes.get(id)?.label || id)
      const message = `Workflow contains a cycle: ${names.join(" → ")}`
      this.hasFailures = true
      this.firstErrorMessage = message
      for (const id of cycle) {
        this.failedNodes.add(id)
        this.updateNodeStatus(id, "failed", { status: "error", error: message })
      }
      return this.buildOutput(caseName, startedAt, seed, "failed")
    }

    let entryNodeIds: string[] = []
    if (options.startNodeIds && options.startNodeIds.length > 0) {
      entryNodeIds = options.startNodeIds.filter((id) => nodes.has(id))
    }
    if (entryNodeIds.length === 0) {
      const startNode = workflow.nodes.find((n) => n.type === "start")
      if (!startNode) {
        return this.buildOutput(caseName, startedAt, seed, "failed")
      }
      entryNodeIds = [startNode.nodeId]
    }
    this.resumeEntryIds = new Set(options.resume ? entryNodeIds : [])

    if (options.cancelSignal?.aborted) {
      return this.buildOutput(caseName, startedAt, seed, "failed")
    }

    try {
      if (entryNodeIds.length === 1) {
        await this.executeFromNode(entryNodeIds[0]!, nodes, edges, options.cancelSignal)
      } else {
        const tasks = entryNodeIds.map((id) =>
          this.executeFromNode(id, nodes, edges, options.cancelSignal),
        )
        const settled = await Promise.allSettled(tasks)
        for (const result of settled) {
          if (result.status === "rejected" && !(result.reason instanceof StopBranch)) {
            this.hasFailures = true
            if (!this.firstErrorMessage) {
              this.firstErrorMessage = String(result.reason)
            }
            throw result.reason
          }
        }
      }

      await this.waitForStreamTasks()
      const finalStatus: "passed" | "failed" = this.hasFailures ? "failed" : "passed"
      return this.buildOutput(caseName, startedAt, seed, finalStatus)
    } catch (error) {
      if (error instanceof StopBranch) {
        // The Ready branch can fail while a stream consumer is still running.
        // Settle those consumers before snapshotting the run so no completed
        // run can retain a running stream node or omit its terminal result.
        this.abortStreamListeners()
        await this.waitForStreamTasks()
        return this.buildOutput(caseName, startedAt, seed, "failed")
      }
      throw error
    } finally {
      // A trigger-path failure, cancellation, or executor exception must not
      // leave a stream alive. Successful runs have already waited above, so
      // this is a no-op in the normal case.
      this.abortStreamListeners()
      await this.waitForStreamTasks()
    }
  }

  /**
   * Lay down what the source run of a rerun settled: the results of every node
   * outside the scope (see core/runner/resume.ts), and the branches each such
   * merge joined, which `{{prev[i]...}}` reads after it. Seeded results are
   * read like any other but never reported as this run's.
   */
  private seedResume(seed: ResumeSeed, nodes: ReadonlyMap<string, WorkflowNode>, edges: readonly WorkflowEdge[]): void {
    this.resumeScope = seed.scope
    for (const name of seed.maskedVariables) this.maskedSeedVariables.add(name)
    for (const stored of seed.results) {
      const node = nodes.get(stored.nodeId)
      if (!node || seed.scope.has(stored.nodeId)) continue
      this.results.set(stored.nodeId, seededNodeResult(stored, node.type))
      this.seededNodeIds.add(stored.nodeId)
    }
    for (const id of this.seededNodeIds) {
      if (nodes.get(id)?.type === "merge") this.branchResults.set(id, this.mergeBranchResults(id, edges))
    }
  }

  /**
   * The result a rerun entry's `{{prev}}` reads. In a normal run a node starts
   * as its first predecessor lands, so the latest result is that
   * predecessor's. An entry starts with every seeded result laid down in the
   * source run's completion order, where the latest may be on another branch:
   * it reads instead its predecessor that completed first in the source run.
   */
  private seededPrev(nodeId: string, edges: readonly WorkflowEdge[]): readonly [string, NodeResult] | null {
    const predecessors = new Set(edges.filter((e) => e.target === nodeId).map((e) => e.source))
    return [...this.results.entries()].find(([id]) => predecessors.has(id)) ?? null
  }

  // -------------------- Node execution --------------------

  /**
   * Record that `nodeId` failed and stop the branch.
   *
   * Shared by every call site that catches a node's own error and a
   * downstream one propagating through it, so the bookkeeping — first error
   * message, failed-node set — stays in one place. A node that may continue
   * past its own failure (`config.continueOnFail`) never throws to here.
   * Rethrows `StopBranch` (a signal, not a failure) without recording it.
   */
  private recordNodeFailure(nodeId: string, error: unknown): never {
    if (error instanceof StopBranch) throw error
    this.hasFailures = true
    this.failedNodes.add(nodeId)
    if (!this.firstErrorMessage) {
      this.firstErrorMessage = String(error)
    }
    throw error
  }

  /**
   * Wait for a traversal already in flight for `nodeId`, if one exists.
   *
   * Resolves `true` once the caller should stop (someone else is already
   * handling this node); `false` means no traversal is running and the caller
   * must start one.
   */
  private async joinInFlightRun(nodeId: string): Promise<boolean> {
    const inFlight = this.nodeRuns.get(nodeId)
    if (!inFlight) return false
    const outcome = await inFlight
    if (outcome instanceof StopBranch) throw outcome
    return true
  }

  /**
   * Enter a node from one incoming path, running it at most once per run.
   *
   * Traversal walks every edge, so a node that two paths converge on used to be
   * executed once per path — for an http-request node that means the request is
   * genuinely sent twice, and the canvas shows the node go running → failed →
   * running → failed (`video/apiweave 4.mp4`, t=13.7–14.4s). `merge` was the
   * only node type immune, because it carries its own `mergeCompleted` guard.
   *
   * The second arrival joins the first instead of starting a second one: it
   * waits for that subtree to finish and returns without traversing further,
   * which is also what stops the *downstream* being walked twice. `StopBranch`
   * propagates, because a stopped branch is stopped for whoever is standing in
   * it; any other failure is already recorded on `failedNodes` by the first
   * arrival and is not re-reported here.
   *
   * `merge` keeps its own guard rather than this one — it has to be entered by
   * each branch in order to know its predecessors have landed.
   */
  private async executeFromNode(
    nodeId: string,
    nodes: Map<string, WorkflowNode>,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
  ): Promise<void> {
    const node = nodes.get(nodeId)
    if (!node) return
    if (cancelSignal?.aborted) return

    if (node.type === "merge" || node.type === "start") {
      return this.traverseFromNode(node, nodes, edges, cancelSignal)
    }

    if (await this.joinInFlightRun(nodeId)) return

    // Resolved with the outcome rather than rejected: nothing is guaranteed to
    // await this handle, and a rejected promise nobody awaits is an unhandled
    // rejection.
    let settle!: (outcome: unknown) => void
    this.nodeRuns.set(nodeId, new Promise<unknown>((resolve) => { settle = resolve }))

    let outcome: unknown = null
    try {
      await this.traverseFromNode(node, nodes, edges, cancelSignal)
    } catch (error) {
      outcome = error
      throw error
    } finally {
      // In `finally` because the traversal returns early on several paths, and
      // a handle left pending would hang every other path into this node.
      settle(outcome)
    }
  }

  // fallow-ignore-next-line complexity -- this is the pre-existing single-node traversal body (node exec, assertion routing, branch fan-out/fan-in), lifted out of the old executeFromNode by the run-dedup guard above it rather than newly written; splitting the traversal engine itself is a separate effort from that guard
  private async traverseFromNode(
    node: WorkflowNode,
    nodes: Map<string, WorkflowNode>,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
  ): Promise<void> {
    const nodeId = node.nodeId

    // Set branch context if predecessor is a merge
    const incomingEdges = edges.filter((e) => e.target === nodeId)
    if (incomingEdges.length > 0) {
      for (const edge of incomingEdges) {
        const predId = edge.source
        const predBranches = this.branchResults.get(predId)
        if (predBranches) {
          const nextEdgesFromNode = edges.filter((e) => e.source === nodeId)
          if (nextEdgesFromNode.length > 1) {
            this.currentBranchContext = predBranches
          } else {
            this.currentBranchContext = []
          }
          break
        }
      }
    }

    // Run every node in its own `entryPrev` context, so one an entry's SSE
    // consumer reaches does not inherit the entry's.
    const prev = this.resumeEntryIds.has(nodeId) ? this.seededPrev(nodeId, edges) : undefined

    // A stream node has two phases. The Ready path continues after its
    // handshake; its Complete path is scheduled by the background consumer when
    // it closes.
    if (isStreamNode(node)) {
      const ready = await this.entryPrev.run(prev, () => this.startStreamListener(node, nodes, edges, cancelSignal))
      if (!ready) return
    // Execute node (skip start)
    } else if (node.type !== "start") {
      try {
        const nodeExecResult = await this.entryPrev.run(prev, () => this.executeNode(node, edges, cancelSignal))
        if (nodeExecResult !== null && nodeExecResult.shouldContinue === false) {
          return
        }
      } catch (error) {
        this.recordNodeFailure(nodeId, error)
      }
    } else {
      this.updateNodeStatus(nodeId, "passed")
    }
    if (cancelSignal?.aborted) return

    // Find next nodes
    let nextEdges = edges.filter((e) => e.source === nodeId)
    if (isStreamNode(node)) {
      nextEdges = nextEdges.filter((edge) => edge.sourceHandle === "ready")
    }
    if (nextEdges.length === 0) return

    // Assertion routing
    if (node.type === "assertion" && this.results.has(nodeId)) {
      const assertionResult = this.results.get(nodeId)!
      const outcome = assertionResult.assertionOutcome ?? "pass"
      const assertionContinueOnFail =
        typeof node.config?.["continueOnFail"] === "boolean"
          ? node.config["continueOnFail"]
          : false

      const handleEdges = nextEdges.filter((e) => e.sourceHandle === "pass" || e.sourceHandle === "fail")
      const legacyEdges = nextEdges.filter((e) => !e.sourceHandle)

      if (handleEdges.length > 0) {
        const matching = handleEdges.filter((e) => e.sourceHandle === outcome)
        if (matching.length > 0) {
          nextEdges = matching
        } else {
          if (outcome === "fail") {
            this.hasFailures = true
            this.failedNodes.add(nodeId)
          }
          return
        }
      } else if (legacyEdges.length > 0) {
        if (outcome === "fail") {
          this.hasFailures = true
          this.failedNodes.add(nodeId)
          if (!assertionContinueOnFail) {
            const errorMsg = assertionResult.message ?? "Assertion failed"
            throw new StopBranch(errorMsg)
          }
        }
        nextEdges = legacyEdges
      }
    }

    // Branching
    if (nextEdges.length > 1) {
      if (node.type !== "merge") {
        this.currentBranchContext = []
      }

      const tasks: Promise<void>[] = []
      for (const edge of nextEdges) {
        const nextNodeId = edge.target
        const nextNode = nodes.get(nextNodeId)
        if (nextNode) {
          if (nextNode.type === "end") {
            this.updateNodeStatus(nextNodeId, "passed")
          } else {
            tasks.push(this.executeBranch(nextNodeId, nodes, edges, cancelSignal))
          }
        }
      }

      if (tasks.length > 0) {
        const settled = await Promise.allSettled(tasks)
        const failedCount = settled.filter(
          (r) => r.status === "rejected" && !(r.reason instanceof StopBranch),
        ).length

        if (failedCount > 0) {
          for (let i = 0; i < settled.length; i++) {
            const r = settled[i]!
            if (r.status === "rejected" && !(r.reason instanceof StopBranch)) {
              const branchNodeId = nextEdges[i]!.target
              this.hasFailures = true
              this.failedNodes.add(branchNodeId)
              if (!this.firstErrorMessage) {
                this.firstErrorMessage = String(r.reason)
              }
            }
          }
        }

        if (failedCount > 0 && failedCount === tasks.length) {
          throw new Error(`All ${tasks.length} branches failed`)
        }
      }
    } else {
      const edge = nextEdges[0]!
      const nextNodeId = edge.target
      const nextNode = nodes.get(nextNodeId)
      if (nextNode) {
        if (nextNode.type === "end") {
          this.updateNodeStatus(nextNodeId, "passed")
        } else {
          try {
            await this.executeFromNode(nextNodeId, nodes, edges, cancelSignal)
          } catch (error) {
            this.recordNodeFailure(nextNodeId, error)
          }
        }
      }
    }
  }

  private async executeBranch(
    nodeId: string,
    nodes: Map<string, WorkflowNode>,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
  ): Promise<void> {
    await this.executeFromNode(nodeId, nodes, edges, cancelSignal)
  }

  private async executeNode(
    node: WorkflowNode,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
  ): Promise<{ shouldContinue: boolean } | null> {
    const nodeId = node.nodeId
    const nodeType = node.type
    // Failure handling is per node: its own `continueOnFail` (http-request,
    // delay and merge all expose one; assertions read theirs in
    // `traverseFromNode`). There is no workflow-level default.
    const effectiveContinueOnFail =
      typeof node.config?.["continueOnFail"] === "boolean" ? (node.config["continueOnFail"] as boolean) : false

    this.updateNodeStatus(nodeId, "running")
    // Stamp the node's execution window on the injected clock so the run
    // timeline/waterfall can place bars on an absolute run timeline.
    const nodeStartedAt = this.deps.clock.isoNow()
    const secretRefs = collectSecretRefs(node.config)

    try {
      let result: NodeResult

      if (nodeType === "http-request") {
        result = await this.executeHttpRequestNode(node, cancelSignal)
      } else if (nodeType === "grpc") {
        result = await this.executeGrpc(node, cancelSignal)
      } else if (nodeType === "delay") {
        result = await this.executeDelay(node, cancelSignal)
      } else if (nodeType === "assertion") {
        result = await this.executeAssertion(node, edges)
      } else if (nodeType === "merge") {
        result = await this.executeMerge(node, edges, cancelSignal)
      } else if (nodeType === "workflow") {
        result = await this.executeCallWorkflow(node, cancelSignal)
      } else {
        result = { status: "skipped", message: `Unknown node type: ${nodeType}` }
      }

      // A node the cancel cut short is neither passed nor failed: it never got
      // to finish. One that finished before the cancel landed keeps its result.
      if (cancelSignal?.aborted && result.status !== "success" && result.status !== "redirect") {
        this.recordCancelledNode(nodeId, { ...result, type: nodeType, startedAt: nodeStartedAt, secretRefs })
        return { shouldContinue: false }
      }

      // Determine execution status
      let executionStatus = result.status ?? "success"
      if (executionStatus === "client_error" || executionStatus === "server_error" || executionStatus === "error") {
        executionStatus = "error"
        this.hasFailures = true
        this.failedNodes.add(nodeId)
      } else if (executionStatus === "redirect") {
        executionStatus = "warning"
      } else if (executionStatus === "failed" && nodeType === "assertion") {
        executionStatus = "error"
        this.hasFailures = true
        this.failedNodes.add(nodeId)
        if (!this.firstErrorMessage) this.firstErrorMessage = result.message ?? "Assertion failed"
      }

      // Check if merge was completed by another branch
      if (result.mergedByOther) {
        return { shouldContinue: false }
      }

      // Update node status
      const mappedStatus: RunnerNodeStatus = executionStatus === "success" || executionStatus === "warning" ? "passed" : "failed"
      const nodeCompletedAt = this.deps.clock.isoNow()
      result = { ...result, type: nodeType, startedAt: nodeStartedAt, completedAt: nodeCompletedAt, secretRefs }
      this.results.set(nodeId, result)
      this.updateNodeStatus(nodeId, mappedStatus, result)

      // Handle failures
      if (executionStatus === "error" && nodeType !== "assertion" && !effectiveContinueOnFail) {
        const errorMsg = (result.error as string | undefined) ?? `Node ${nodeId} failed`
        this.hasFailures = true
        this.failedNodes.add(nodeId)
        if (!this.firstErrorMessage) this.firstErrorMessage = `Node ${nodeId} failed`
        throw new StopBranch(errorMsg)
      }

      return { shouldContinue: true }
    } catch (error) {
      if (error instanceof StopBranch) throw error
      if (cancelSignal?.aborted) {
        this.recordCancelledNode(nodeId, { status: "cancelled", type: nodeType, startedAt: nodeStartedAt, secretRefs })
        return { shouldContinue: false }
      }
      const errorResult: NodeResult = {
        status: "error",
        error: String(error),
        startedAt: nodeStartedAt,
        completedAt: this.deps.clock.isoNow(),
        secretRefs,
      }
      this.updateNodeStatus(nodeId, "failed", errorResult)
      this.results.set(nodeId, errorResult)
      this.failedNodes.add(nodeId)
      this.hasFailures = true
      if (!this.firstErrorMessage) this.firstErrorMessage = `Node ${nodeId} failed`
      if (!effectiveContinueOnFail) throw new StopBranch(errorResult.error ?? `Node ${nodeId} failed`)
      throw error
    }
  }

  /**
   * Record a node the run's cancel cut short. `skipped` is the node vocabulary
   * for "did not run to completion, and is not a failure" — the run itself is
   * what carries `cancelled`. The caller stops the branch without failing it.
   */
  private recordCancelledNode(nodeId: string, result: NodeResult): NodeResult {
    const cancelled: NodeResult = { ...result, status: "cancelled", completedAt: this.deps.clock.isoNow() }
    this.results.set(nodeId, cancelled)
    this.updateNodeStatus(nodeId, "skipped", cancelled)
    return cancelled
  }

  // -------------------- HTTP request --------------------

  private async executeHttpRequest(node: WorkflowNode, cancelSignal?: AbortSignal, forceRefreshToken = false): Promise<NodeResult> {
    const config = node.config ?? {}
    const bodyType = config["bodyType"] as string | undefined
    // JSON-RPC over HTTP is always a POST, whatever method the node was left on.
    let method = bodyType === "jsonrpc" ? "POST" : ((config["method"] as string | undefined) ?? "GET")
    let url = (config["url"] as string | undefined) ?? ""
    type KVField = ReadonlyArray<{ readonly key: string; readonly value: string; readonly active?: boolean }> | undefined
    const headersField = config["headers"] as KVField
    const body = config["body"] as string | Record<string, unknown> | undefined
    const timeout = (config["timeout"] as number | undefined) ?? 30
    const auth = config["auth"] as HttpAuthConfig | undefined
    // A signature covers one URL: a redirect would carry it somewhere it does not fit.
    const signed = auth?.type === "awsSigV4" || auth?.type === "digest"
    const followRedirects = !signed && ((config["followRedirects"] as boolean | undefined) ?? true)
    const sslVerify = (config["sslVerify"] as boolean | undefined) ?? true
    const useCookieJar = (config["useCookieJar"] as boolean | undefined) ?? true
    const formDataEntries = config["formDataEntries"] as readonly FormDataEntryLike[] | undefined
    const urlEncodedEntries = config["urlEncodedEntries"] as KVField
    const fileUploads = config["fileUploads"] as readonly FileUploadLike[] | undefined
    const extractors = config["extractors"] as Record<string, string> | undefined
    const expectedStatus = config["expectedStatus"] as number | readonly number[] | undefined
    const allowRpcError = (config["allowRpcError"] as boolean | undefined) ?? false
    const withExtractorOutcomes = (result: NodeResult): NodeResult => extractors
      ? { ...result, extractorOutcomes: this.extractVariables(node.nodeId, extractors, result) }
      : result

    if (!url) {
      throw new Error("URL is required for HTTP request")
    }

    url = this.substituteVariables(url, { allowSecrets: false })

    if (this.deps.baseUrl && !url.startsWith("http")) {
      url = `${this.deps.baseUrl}${url}`
    }

    const pathVariables = this.normalizeKeyValueField(config["pathVariables"] as KVField)
    for (const [key, value] of Object.entries(pathVariables)) {
      url = url.split(`{${key}}`).join(encodeURIComponent(value))
    }

    let headers = this.normalizeKeyValueField(headersField)
    const queryParams = this.normalizeKeyValueField(config["queryParams"] as KVField)
    const cookies = this.normalizeKeyValueField(config["cookies"] as KVField)

    if (Object.keys(cookies).length > 0) {
      const cookieHeader = Object.entries(cookies)
        .map(([key, value]) => `${key}=${value}`)
        .join("; ")
      const existingCookie = headers["Cookie"] ?? headers["cookie"]
      headers["Cookie"] = existingCookie ? `${existingCookie}; ${cookieHeader}` : cookieHeader
    }

    let digest: { readonly username: string; readonly password: string } | undefined
    try {
      await this.applyAuthConfig(auth, headers, queryParams, {
        signal: cancelSignal, timeoutMs: timeout * 1000, sslVerify, forceRefresh: forceRefreshToken,
      })
      if (auth?.type === "digest") {
        digest = {
          username: this.substituteVariables(auth.digest?.username ?? ""),
          password: this.authSecret("Digest auth", "password", auth.digest?.password, true)!,
        }
      }
    } catch (authError) {
      if (!(authError instanceof AuthError)) throw authError
      return withExtractorOutcomes({ status: "error", error: authError.message, method, url, duration: 0 })
    }

    let fetchBody: string | Buffer | UndiciFormData | undefined
    try {
      fetchBody = bodyType === "graphql"
        ? this.buildGraphqlRequest(config["graphql"] as GraphqlBody | undefined, method, headers, queryParams)
        : bodyType === "jsonrpc"
          ? this.buildJsonrpcRequest(config["jsonrpc"] as JsonrpcBody | undefined, headers)
          : bodyType === "soap"
            ? this.buildSoapRequest(config["soap"] as SoapBody | undefined, headers)
            : await this.buildHttpRequestBody(bodyType, body, headers, formDataEntries, urlEncodedEntries, fileUploads)
    } catch (bodyError) {
      return withExtractorOutcomes({ status: "error", error: `Failed to build request body: ${String(bodyError)}`, method, url: appendQueryParams(url, queryParams), duration: 0 })
    }

    url = appendQueryParams(url, queryParams)

    // The pre-request script sees the request exactly as it would be sent —
    // placeholders resolved, auth applied — so it can sign it, and may change
    // any of it. Whatever it leaves still goes through SafeHttp's URL checks.
    const scripts = config["scripts"] as HttpScriptsConfig | undefined
    let preRequest: ScriptOutcome | undefined
    if (scripts?.preRequest?.trim()) {
      const textBody = typeof fetchBody === "string" ? fetchBody : null
      const run = await this.runNodeScript("preRequest", scripts.preRequest, scripts, {
        request: { method, url, headers: { ...headers }, body: textBody },
      }, cancelSignal)
      preRequest = run.outcome
      if (!run.request) {
        return withExtractorOutcomes({ status: "error", error: scriptFailure(run.outcome) ?? "Pre-request script failed", method, url, duration: 0, scripts: [run.outcome] })
      }
      method = run.request.method
      url = run.request.url
      headers = run.request.headers
      if (run.request.body !== textBody) fetchBody = run.request.body ?? undefined
    }
    const withScripts = (result: NodeResult): NodeResult =>
      withExtractorOutcomes(preRequest ? { ...result, scripts: [preRequest] } : result)

    // Signed last, over exactly what is sent — after the script, on every attempt.
    if (auth?.type === "awsSigV4") {
      try {
        ({ url, headers, body: fetchBody } = await this.signAwsRequest(auth.awsSigV4, method, url, headers, fetchBody))
      } catch (authError) {
        if (!(authError instanceof AuthError)) throw authError
        return withScripts({ status: "error", error: authError.message, method, url, duration: 0 })
      }
    }

    // A placeholder `substituteVariables` could not resolve is left in the
    // request verbatim, so the assembled end state tells us what went out
    // unresolved. Reported per node so a `{{env.*}}`/`{{variables.*}}` that
    // stayed literal — commonly a 401 from the target that reads as bad
    // credentials — surfaces on the run result instead of looking like a
    // service error.
    const unresolvedPlaceholders = collectUnresolvedPlaceholders([
      url,
      ...Object.values(headers),
      ...Object.values(queryParams),
      ...(typeof fetchBody === "string" ? [fetchBody] : []),
    ])

    const startTime = Date.now()

    try {
      this.deps.http.validateUrl(url)

      // The node's timeout is the only deadline: SafeHttp composes it with the
      // cancel signal, and its own default applies to callers that set none.
      const fetchInit: UndiciRequestInit = {
        method,
        headers,
        ...(cancelSignal ? { signal: cancelSignal } : {}),
      }
      if (fetchBody !== undefined && method !== "GET") {
        fetchInit.body = fetchBody
      }

      const fetchOptions = {
        followRedirects,
        rejectUnauthorized: sslVerify,
        timeoutMs: timeout * 1000,
        ...(useCookieJar ? { cookieJar: this.cookieJar } : {}),
      }
      let response = await this.deps.http.safeFetch(url, fetchInit, fetchOptions)
      // Digest: the server's 401 carries the challenge; answer it once.
      const challenge = digest && response.status === 401 ? parseDigestChallenge(response.headers.get("www-authenticate") ?? "") : null
      if (digest && challenge) {
        await response.body?.cancel()
        const target = new URL(url)
        const authorization = digestAuthorization(challenge, { ...digest, method, uri: `${target.pathname}${target.search}` })
        const answered = Object.fromEntries(Object.entries(headers).filter(([name]) => name.toLowerCase() !== "authorization"))
        response = await this.deps.http.safeFetch(url, { ...fetchInit, headers: { ...answered, Authorization: authorization } }, fetchOptions)
      }
      // An OAuth token the API no longer accepts (revoked, rotated, or expired
      // early): fetch a fresh one and send the request once more.
      if (response.status === 401 && auth?.type === "oauth2" && !forceRefreshToken) {
        await response.body?.cancel()
        return this.executeHttpRequest(node, cancelSignal, true)
      }
      const { bytes, truncated } = await this.deps.http.readBodyCapped(response, SIDE_TABLE_THRESHOLD_BYTES)
      const statusCode = response.status
      const duration = Date.now() - startTime
      const responseText = decodeBody(bytes, response.headers.get("content-type") ?? "", truncated)
      // fetch decodes gzip/br/deflate, but Content-Length counts the encoded
      // bytes, so it is only the body's size when nothing was decoded.
      const encoding = response.headers.get("content-encoding")
      const declaredSize = !encoding || encoding === "identity" ? Number(response.headers.get("content-length") ?? "") : Number.NaN
      const responseSizeBytes = !truncated ? bytes.byteLength : Number.isFinite(declaredSize) && declaredSize > 0 ? declaredSize : undefined

      let responseBody: unknown
      if (responseText === null) {
        responseBody = bytes.toString("base64")
      } else if (truncated) {
        responseBody = responseText
      } else {
        try {
          responseBody = JSON.parse(responseText)
        } catch {
          responseBody = responseText
        }
      }

      let status: string
      if (statusCode >= 200 && statusCode < 300) status = "success"
      else if (statusCode >= 300 && statusCode < 400) status = "redirect"
      else if (statusCode >= 400 && statusCode < 500) status = "client_error"
      else if (statusCode >= 500) status = "server_error"
      else status = "unknown"

      // expectedStatus fully replaces the default 2xx-passes rule when set: a
      // matched non-2xx (e.g. an intentional 409) passes, and an unmatched 2xx
      // (the guard regressed) fails — polarity a status-range check alone can't express.
      if (expectedStatus !== undefined) {
        const expectedList = Array.isArray(expectedStatus) ? expectedStatus : [expectedStatus]
        status = expectedList.includes(statusCode) ? "success" : "error"
      }

      // A JSON-RPC server answers 200 with an `error` member when the call
      // failed, exactly like a GraphQL `errors` array. Unlike GraphQL, the
      // node fails on it by default; `allowRpcError` opts out so an assertion
      // can check `response.body.error`.
      const rpcErrorFailure = bodyType === "jsonrpc" && !allowRpcError ? jsonRpcErrorFailure(responseBody) : undefined
      if (rpcErrorFailure !== undefined) {
        status = "error"
      }

      // A SOAP Fault is the message's own failure report on an HTTP 200. It
      // fails the node unless the expected status says this outcome was wanted.
      const soapFault = bodyType === "soap" && typeof responseBody === "string" ? findSoapFault(responseBody) : undefined
      if (soapFault !== undefined && expectedStatus === undefined) {
        status = "error"
      }

      const responseHeaders = toHeaderRecord(response.headers)

      const result: NodeResult = {
        status,
        statusCode,
        ...(expectedStatus !== undefined ? { expectedStatus } : {}),
        ...(rpcErrorFailure !== undefined ? { error: rpcErrorFailure } : {}),
        ...(soapFault !== undefined && status === "error" ? { error: soapFaultText(soapFault) } : {}),
        headers: responseHeaders,
        body: responseBody,
        duration,
        method,
        url,
        response: {
          body: responseBody,
          headers: responseHeaders,
          statusCode,
          ...(truncated ? { truncated: true } : {}),
          ...(responseText === null ? { bodyEncoding: "base64" as const } : {}),
          ...(responseSizeBytes !== undefined ? { responseSizeBytes } : {}),
          ...(soapFault === undefined ? {} : { fault: soapFault }),
        },
        ...(unresolvedPlaceholders.length > 0 ? { unresolvedPlaceholders } : {}),
      }

      return withScripts(result)
    } catch (error) {
      if (error instanceof SafeUrlError || error instanceof AuthError) {
        return withScripts({
          status: "error",
          error: error.message,
          method,
          url,
          duration: 0,
          ...(expectedStatus !== undefined ? { expectedStatus } : {}),
          ...(unresolvedPlaceholders.length > 0 ? { unresolvedPlaceholders } : {}),
        })
      }
      return withScripts({
        status: "error",
        // Sent but unanswered (refused, reset, timed out): a retry may get through.
        networkError: true,
        error: cancelSignal?.aborted
          ? "Request cancelled"
          : error instanceof Error && error.name === "TimeoutError"
            ? `Request timed out after ${timeout}s`
            : (describeNetworkError(error, url) ?? String(error)),
        method,
        url,
        duration: Date.now() - startTime,
        ...(expectedStatus !== undefined ? { expectedStatus } : {}),
        ...(unresolvedPlaceholders.length > 0 ? { unresolvedPlaceholders } : {}),
      })
    }
  }

  /**
   * The node's request (retried per `config.retry`), then its post-response
   * script, once, on the response the node ends with. A request that got no
   * response has nothing for the script to read, so the script does not run.
   * Finally the contract check: with `contract` on, the response body must
   * match the `responseSchemas` entry for its status (exact, then class, then
   * default), and a status the schemas do not declare is itself a violation.
   */
  private async executeHttpRequestNode(node: WorkflowNode, cancelSignal?: AbortSignal): Promise<NodeResult> {
    const result = await this.executeHttpRequestWithScript(node, cancelSignal)
    const contract = effectiveContract(node.config, this.deps.contract)
    if (contract === "off") return result
    const schemas = node.config?.["responseSchemas"] as Readonly<Record<string, unknown>> | undefined
    if (schemas === undefined) return result
    if (result.statusCode === undefined || cancelSignal?.aborted) return result

    const key = responseSchemaKey(schemas, result.statusCode)
    let evaluation: AssertionEvaluation
    if (key === undefined) {
      evaluation = this.undeclaredStatusEvaluation(node.nodeId, result, schemas)
    } else {
      const rule = { source: "prev", path: "response.body", operator: "matchesSchema", expectedValue: schemas[key] } as const
      await this.prepareRules([rule])
      evaluation = this.evaluateAssertion(0, rule, () => ({ state: "resolved", nodeId: node.nodeId, result }))
    }

    const checked: NodeResult = { ...result, assertionEvaluations: [evaluation] }
    // "warn" records and shows the violation without failing the node.
    if (evaluation.outcome === "pass" || contract === "warn") return checked
    // A request that already failed keeps its own reason; the violations are in `assertions`.
    const error =
      key === undefined
        ? `Response status ${result.statusCode} is not declared by the contract (declared: ${Object.keys(schemas).join(", ")})`
        : `Response does not match the schema for status ${key}`
    return { ...checked, status: "error", error: result.error ?? error }
  }

  /** The violation for a status `responseSchemas` never declared: a single SchemaViolation at the root. */
  private undeclaredStatusEvaluation(
    nodeId: string,
    result: NodeResult,
    schemas: Readonly<Record<string, unknown>>,
  ): AssertionEvaluation {
    const declared = Object.keys(schemas).sort().join(", ")
    return {
      ruleIndex: 0,
      source: "prev",
      path: "",
      operator: "matchesSchema",
      sourceNodeId: nodeId,
      expectedState: "literal",
      expectedType: null,
      actualState: "present",
      actualType: jsonValueType(result.body),
      outcome: "fail",
      reasonCode: "comparison-failed",
      detail: `status ${result.statusCode} is not declared`,
      schemaErrors: [{ path: "", message: `Status ${result.statusCode} is not declared by the contract (declared: ${declared})` }],
    }
  }

  private async executeHttpRequestWithScript(node: WorkflowNode, cancelSignal?: AbortSignal): Promise<NodeResult> {
    const result = await this.executeHttpRequestWithRetry(node, cancelSignal)
    const scripts = node.config?.["scripts"] as HttpScriptsConfig | undefined
    if (!scripts?.postResponse?.trim() || result.statusCode === undefined || cancelSignal?.aborted) return result
    const response: ScriptResponse = {
      status: result.statusCode,
      headers: result.headers ?? {},
      body: result.body,
      responseTime: result.duration ?? 0,
    }
    const run = await this.runNodeScript("postResponse", scripts.postResponse, scripts, { response }, cancelSignal)
    const outcomes = [...(result.scripts ?? []), run.outcome]
    const failure = scriptFailure(run.outcome)
    if (failure === undefined) return { ...result, scripts: outcomes }
    // A request that already failed keeps its own reason; the script's is in `scripts`.
    return { ...result, status: "error", error: result.error ?? failure, scripts: outcomes }
  }

  /** Runs one of a node's scripts against this run's variables, environment, data row and the secrets it names. */
  private runNodeScript(
    phase: ScriptOutcome["phase"],
    source: string,
    scripts: HttpScriptsConfig,
    subject: { readonly request: ScriptRequest } | { readonly response: ScriptResponse },
    cancelSignal: AbortSignal | undefined,
  ): Promise<ScriptRunResult> {
    const secrets: Record<string, string> = {}
    for (const name of scriptSecretNames(source)) {
      const value = this.deps.secrets?.[name]
      if (value !== undefined) secrets[name] = value
    }
    return runScript({
      phase,
      source,
      timeoutMs: scripts.timeoutMs ?? DEFAULT_SCRIPT_TIMEOUT_MS,
      variables: this.workflowVariables,
      env: this.environmentVariables,
      data: this.deps.data ?? {},
      secrets,
      ...subject,
      uuid: () => this.deps.functions.uuid(),
    }, cancelSignal)
  }

  /**
   * The node's request, sent again per `config.retry` — the structured way to
   * poll, since a workflow has no loops. Each attempt is a full request
   * (placeholders and extractors re-run), and the node's result is the last
   * attempt's plus the list of every attempt. A request that could not be sent
   * at all (a blocked URL, a body that would not build) is not retried.
   */
  private async executeHttpRequestWithRetry(node: WorkflowNode, cancelSignal?: AbortSignal): Promise<NodeResult> {
    const retry = node.config?.["retry"] as HttpRetryConfig | undefined
    if (!retry) return this.executeHttpRequest(node, cancelSignal)
    const until = retry.until ?? []
    await this.prepareRules(until)
    const attempts: HttpAttempt[] = []
    for (;;) {
      const attempt = await this.executeHttpRequest(node, cancelSignal)
      attempts.push(toHttpAttempt(attempt))
      const result: NodeResult = { ...attempt, attempts }
      if (cancelSignal?.aborted) return { ...result, status: "cancelled" }
      if (this.retryDone(node.nodeId, attempt, until)) return result

      if (attempts.length >= retry.maxAttempts) {
        // The scheduler keeps this verdict and classes the cause like any other error.
        return { ...result, status: "error", error: retryExhaustedError(attempt, attempts.length, until.length > 0) }
      }
      // Harness mode collapses waits, as it does for Delay.
      const waitMs = this.deps.baseUrl ? 0 : retryDelayMs(retry, attempts.length)
      if (!(await waitFor(waitMs, cancelSignal))) return { ...result, status: "cancelled" }
    }
  }

  /** Whether `attempt` ends the retries: it was never sent, or it meets `until` (with no condition, any response below 500). */
  private retryDone(nodeId: string, attempt: NodeResult, until: NonNullable<HttpRetryConfig["until"]>): boolean {
    const sent = attempt.statusCode !== undefined || attempt["networkError"] === true
    if (!sent) return true
    if (until.length === 0) return attempt["networkError"] !== true && (attempt.statusCode ?? 0) < 500
    return until.every((rule, index) =>
      this.evaluateAssertion(index, rule, () => ({ state: "resolved", nodeId, result: attempt })).outcome === "pass")
  }

  // -------------------- gRPC --------------------

  /**
   * A unary gRPC call. Any status but the expected one (OK unless
   * `expectedStatus` names another) fails the node; the result carries the
   * decoded message, the status, and the initial and trailing metadata.
   */
  // fallow-ignore-next-line complexity -- one call lifecycle: build the request, resolve the schema, call, classify the status; the failure returns share one result shape.
  private async executeGrpc(node: WorkflowNode, cancelSignal?: AbortSignal): Promise<NodeResult> {
    const prepared = await this.prepareGrpcCall(node, cancelSignal)
    if ("failure" in prepared) return prepared.failure
    const { call, extractors, expectedStatus } = prepared
    const failed = (error: string, extra: Partial<NodeResult> = {}): NodeResult =>
      this.grpcResult(node.nodeId, extractors, { status: "error", error, target: call.target, rpc: call.rpc, duration: 0, ...extra })
    if (node.config?.["callType"] === "server-streaming") {
      return failed("A server-streaming call runs through the stream lifecycle, not this path")
    }
    const startTime = Date.now()
    try {
      this.deps.http.assertHostAllowed(call.target)
      const schema = await loadGrpcSchema(call.connection, call.source)
      const response = await callUnary({
        connection: call.connection,
        schema,
        service: call.service,
        method: call.method,
        message: call.message,
        metadata: call.metadata,
        deadlineMs: call.deadlineMs,
        signal: cancelSignal,
      })
      const duration = Date.now() - startTime
      const ok = expectedStatus === undefined ? response.code === 0 : response.codeName === expectedStatus
      const shaped = {
        body: response.body,
        status: response.codeName,
        statusCode: response.code,
        statusMessage: response.statusMessage,
        headers: response.headers,
        trailers: response.trailers,
      }
      const base = { target: call.target, rpc: call.rpc, duration, statusCode: response.code, headers: response.headers, body: response.body, response: shaped }
      if (ok) return this.grpcResult(node.nodeId, extractors, this.grpcUnresolved(call, { status: "success", ...base }))
      const expectation = expectedStatus === undefined ? "" : ` (expected ${expectedStatus})`
      const reason = response.statusMessage === "" ? "" : `: ${response.statusMessage}`
      return this.grpcResult(node.nodeId, extractors, this.grpcUnresolved(call, { status: "error", ...base, error: `gRPC ${call.rpc} returned ${response.codeName}${expectation}${reason}` }))
    } catch (error) {
      const text = error instanceof SafeUrlError || error instanceof GrpcSchemaError ? error.message : String(error)
      return failed(cancelSignal?.aborted ? "Call cancelled" : text, { duration: Date.now() - startTime })
    }
  }

  /** A node result with the node's extractors applied, so a gRPC node captures variables like an HTTP one. */
  private grpcResult(nodeId: string, extractors: Record<string, string> | undefined, result: NodeResult): NodeResult {
    return extractors ? { ...result, extractorOutcomes: this.extractVariables(nodeId, extractors, result) } : result
  }

  private grpcUnresolved(call: GrpcCall, result: NodeResult): NodeResult {
    return call.unresolvedPlaceholders.length > 0 ? { ...result, unresolvedPlaceholders: call.unresolvedPlaceholders } : result
  }

  /**
   * Everything a gRPC node needs before it connects: the substituted target and
   * message, metadata with auth applied, the schema source and the TLS
   * connection. Shared by the unary call and the server-streaming adapter, so
   * both read the node's config the same way.
   */
  private async prepareGrpcCall(
    node: WorkflowNode,
    cancelSignal: AbortSignal | undefined,
  ): Promise<{ readonly call: GrpcCall; readonly extractors: Record<string, string> | undefined; readonly expectedStatus: string | undefined } | { readonly failure: NodeResult }> {
    const config = node.config ?? {}
    const extractors = config["extractors"] as Record<string, string> | undefined
    const service = (config["service"] as string | undefined) ?? ""
    const method = (config["method"] as string | undefined) ?? ""
    const expectedStatus = config["expectedStatus"] as string | undefined
    const sslVerify = (config["sslVerify"] as boolean | undefined) ?? true
    const deadline = (config["deadline"] as number | undefined) ?? 30
    const target = this.substituteVariables((config["target"] as string | undefined) ?? "", { allowSecrets: false }).trim()
    const rpc = `${service}/${method}`
    const failed = (error: string, extra: Partial<NodeResult> = {}): { failure: NodeResult } => ({
      failure: this.grpcResult(node.nodeId, extractors, { status: "error", error, target, rpc, duration: 0, ...extra }),
    })
    if (target === "") return failed("Target is required for a gRPC call")
    if (service === "" || method === "") return failed("Service and method are required for a gRPC call")

    let message: unknown
    try {
      message = JSON.parse(this.substituteVariables((config["message"] as string | undefined) ?? "{}", { json: true }))
    } catch {
      return failed("The message is not valid JSON")
    }
    if (typeof message !== "object" || message === null || Array.isArray(message)) return failed("The message must be a JSON object")

    const headers = this.normalizeKeyValueField(config["metadata"] as Array<{ key: string; value: string; active?: boolean }> | undefined)
    const query: Record<string, string> = {}
    const auth = config["auth"] as HttpAuthConfig | undefined
    try {
      if (auth?.type === "awsSigV4" || auth?.type === "digest") throw new AuthError(`${auth.type === "digest" ? "Digest" : "AWS Signature V4"} auth is not supported on gRPC nodes`)
      await this.applyAuthConfig(auth, headers, query, { signal: cancelSignal, timeoutMs: deadline * 1000, sslVerify, forceRefresh: false })
      if (Object.keys(query).length > 0) throw new AuthError("An API key cannot be added to the query of a gRPC call: send it in metadata")
    } catch (authError) {
      if (!(authError instanceof AuthError)) throw authError
      return failed(authError.message)
    }
    const metadata = Object.fromEntries(Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value]))
    const unresolvedPlaceholders = collectUnresolvedPlaceholders([target, JSON.stringify(message), ...Object.values(metadata)])
    const source: GrpcSchemaSource = config["schemaSource"] === "proto"
      ? { kind: "proto", files: (config["protoFiles"] as Record<string, string> | undefined) ?? {} }
      : { kind: "reflection" }
    const connection: GrpcConnection = {
      target,
      tls: (config["tls"] as boolean | undefined) ?? false,
      sslVerify,
      tlsOptionsFor: (url, verify) => this.deps.http.tlsOptionsFor(url, verify),
    }
    return {
      call: { connection, source, service, method, message, metadata, deadlineMs: deadline * 1000, target, rpc, unresolvedPlaceholders },
      extractors,
      expectedStatus,
    }
  }

  // -------------------- Server-Sent Events --------------------
  // -------------------- Stream listeners (SSE, WebSocket) --------------------

  /**
   * One stream node's two-phase lifecycle, protocol-neutral. The protocol's
   * adapter opens the stream; the node's Ready path continues once it has, and
   * a background consumer collects messages until the limit, a finish rule, the
   * timeout or the end of the stream, then records the result and traverses the
   * Complete path. Returns false when the handshake failed (the node's failed
   * result is already recorded and nothing further runs).
   */
  // fallow-ignore-next-line complexity -- this is one listener lifecycle: prepare the request, open the stream, then register its owned task; splitting those transitions obscures the cancellation boundary between them.
  private async startStreamListener(
    node: WorkflowNode,
    nodes: Map<string, WorkflowNode>,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
  ): Promise<boolean> {
    const startedAt = this.deps.clock.isoNow()
    const secretRefs = collectSecretRefs(node.config)
    const startTime = Date.now()
    const abortController = new AbortController()
    const signal = cancelSignal ? AbortSignal.any([abortController.signal, cancelSignal]) : abortController.signal

    this.updateNodeStatus(node.nodeId, "running")
    let prepared: PreparedStream
    try {
      prepared = node.type === "websocket"
        ? await this.prepareWebsocketStream(node, signal)
        : node.type === "grpc"
          ? await this.prepareGrpcStream(node, signal)
          : await this.prepareSseStream(node, signal)
    } catch (error) {
      if (error instanceof StreamHandshakeError) {
        this.completeStreamNode(node, { status: "error", error: error.message, ...error.details, duration: 0 }, startedAt, secretRefs)
        return false
      }
      if (error instanceof SafeUrlError) {
        this.completeStreamNode(node, { status: "error", error: error.message, duration: 0 }, startedAt, secretRefs)
        return false
      }
      throw error
    }

    const { adapter, request, unresolvedPlaceholders } = prepared
    const unresolved = unresolvedPlaceholders.length > 0 ? { unresolvedPlaceholders } : {}
    try {
      await adapter.open()
    } catch (error) {
      await adapter.close().catch(() => undefined)
      const base: NodeResult = { status: "error", ...request, duration: Date.now() - startTime, ...unresolved }
      this.completeStreamNode(node, error instanceof StreamHandshakeError
        ? { ...base, ...error.details, error: error.message }
        : { ...base, error: streamErrorText(error, request.url) }, startedAt, secretRefs)
      return false
    }

    this.streamListeners.set(node.nodeId, abortController)
    let task: Promise<void>
    task = this.consumeStreamListener({ node, nodes, edges, cancelSignal, prepared, startedAt, secretRefs, startTime }).finally(() => {
      this.streamListeners.delete(node.nodeId)
      this.streamTasks.delete(task)
    })
    this.streamTasks.add(task)
    return true
  }

  // fallow-ignore-next-line complexity -- success, an incomplete stream, and cancellation errors are the terminal states of the same listener task; extracting them would split its result ownership.
  private async consumeStreamListener(input: {
    readonly node: WorkflowNode
    readonly nodes: Map<string, WorkflowNode>
    readonly edges: readonly WorkflowEdge[]
    readonly cancelSignal: AbortSignal | undefined
    readonly prepared: PreparedStream
    readonly startedAt: string
    readonly secretRefs: readonly string[]
    readonly startTime: number
  }): Promise<void> {
    const { node, prepared, startedAt, secretRefs, startTime } = input
    const { adapter, request, maxMessages, finishConditions, extractors, unresolvedPlaceholders } = prepared
    const unresolved = unresolvedPlaceholders.length > 0 ? { unresolvedPlaceholders } : {}
    try {
      await this.prepareRules(finishConditions)
      const collected = await collectStreamMessages(adapter, {
        maxMessages,
        ...(finishConditions.length === 0 ? {} : { finishWhen: (message: StreamMessage) => this.streamMessageMatches(message, finishConditions) }),
      })
      const duration = Date.now() - startTime
      const body = adapter.resultBody(collected)
      const handshake = adapter.handshake
      const base = { ...handshake, body, duration, ...request, response: { ...handshake, body, duration }, ...unresolved }
      const incomplete = collected.termination === "stream-ended" && adapter.endsCleanly !== true
      // The node's own status goes last: a protocol status name in the
      // handshake (gRPC's "OK") is result detail, not the node's outcome.
      const result: NodeResult = incomplete
        ? {
            ...base, status: "error",
            error: `${adapter.label} stream ended after ${collected.messageCount}/${maxMessages} captured matching ${adapter.unit}(s)`,
          }
        : { ...base, status: "success" }
      const completed = this.completeStreamNode(node, result, startedAt, secretRefs, extractors)
      if (completed.status === "success") {
        await this.traverseStreamCompleteEdges(node, input.nodes, input.edges, input.cancelSignal)
      }
    } catch (error) {
      await adapter.close().catch(() => undefined)
      this.completeStreamNode(node, {
        status: "error",
        error: streamErrorText(error, request.url),
        ...request,
        duration: Date.now() - startTime,
        ...unresolved,
      }, startedAt, secretRefs, extractors)
    }
  }

  /** The request an SSE node sends: GET with `Accept: text/event-stream`, auth and cookies applied. */
  private async prepareSseStream(node: WorkflowNode, signal: AbortSignal): Promise<PreparedStream> {
    const config = node.config ?? {}
    const timeout = (config["timeout"] as number | undefined) ?? 30
    const followRedirects = (config["followRedirects"] as boolean | undefined) ?? true
    const sslVerify = (config["sslVerify"] as boolean | undefined) ?? true
    const auth = config["auth"] as HttpAuthConfig | undefined
    let url = (config["url"] as string | undefined) ?? ""
    if (!url) throw new StreamHandshakeError("URL is required for SSE stream")

    url = this.substituteVariables(url, { allowSecrets: false })
    if (this.deps.baseUrl && !url.startsWith("http")) url = `${this.deps.baseUrl}${url}`
    let headers = this.normalizeKeyValueField(config["headers"] as KeyValueRows)
    const queryParams = this.normalizeKeyValueField(config["queryParams"] as KeyValueRows)
    try {
      await this.applyAuthConfig(auth, headers, queryParams, {
        // A zero SSE timeout means "no deadline" for the stream, not for the token request.
        signal, timeoutMs: timeout * 1000 || 30_000, sslVerify, forceRefresh: false,
      })
      if (auth?.type === "digest") throw new AuthError("Digest auth: not supported on SSE Stream nodes")
      for (const key of Object.keys(headers)) if (key.toLowerCase() === "accept") delete headers[key]
      headers["Accept"] = "text/event-stream"
      url = appendQueryParams(url, queryParams)
      if (auth?.type === "awsSigV4") {
        ({ url, headers } = await this.signAwsRequest(auth.awsSigV4, "GET", url, headers, undefined))
      }
    } catch (authError) {
      if (!(authError instanceof AuthError)) throw authError
      throw new StreamHandshakeError(authError.message, { method: "GET", url })
    }
    const eventType = config["eventType"] as string | undefined
    return {
      adapter: new SseAdapter({
        http: this.deps.http, url, headers, signal, sslVerify, timeoutMs: timeout * 1000,
        followRedirects: followRedirects && auth?.type !== "awsSigV4",
        cookieJar: this.cookieJar,
        ...(eventType === undefined ? {} : { eventType }),
      }),
      request: { method: "GET", url },
      maxMessages: (config["maxEvents"] as number | undefined) ?? 1,
      finishConditions: (config["finishConditions"] as readonly StreamFinishCondition[] | undefined) ?? [],
      extractors: config["extractors"] as Record<string, string> | undefined,
      unresolvedPlaceholders: collectUnresolvedPlaceholders([url, ...Object.values(headers), ...Object.values(queryParams)]),
    }
  }

  /**
   * The connection a WebSocket node opens. Auth becomes handshake headers (or a
   * query parameter for an API key); the dispatcher carries the network
   * settings, looked up under the http(s) form of the URL so host-scoped client
   * certificates match.
   */
  private async prepareWebsocketStream(node: WorkflowNode, signal: AbortSignal): Promise<PreparedStream> {
    const config = node.config ?? {}
    const timeout = (config["timeout"] as number | undefined) ?? 30
    const sslVerify = (config["sslVerify"] as boolean | undefined) ?? true
    const auth = config["auth"] as HttpAuthConfig | undefined
    let url = (config["url"] as string | undefined) ?? ""
    if (!url) throw new StreamHandshakeError("URL is required for WebSocket stream")

    url = this.substituteVariables(url, { allowSecrets: false })
    const headers = this.normalizeKeyValueField(config["headers"] as KeyValueRows)
    const queryParams = this.normalizeKeyValueField(config["queryParams"] as KeyValueRows)
    try {
      await this.applyAuthConfig(auth, headers, queryParams, {
        signal, timeoutMs: timeout * 1000 || 30_000, sslVerify, forceRefresh: false,
      })
      if (auth?.type === "digest" || auth?.type === "awsSigV4") {
        throw new AuthError(`${auth.type === "digest" ? "Digest" : "AWS Signature V4"} auth: not supported on WebSocket nodes`)
      }
      url = appendQueryParams(url, queryParams)
      this.deps.http.validateWebSocketUrl(url)
    } catch (error) {
      if (error instanceof AuthError || error instanceof SafeUrlError) {
        throw new StreamHandshakeError(error.message, { method: "GET", url })
      }
      throw error
    }
    const outbound: WebsocketMessageToSend[] = ((config["messages"] as readonly WebsocketOutboundConfig[] | undefined) ?? []).map((message) => ({
      data: this.substituteVariables(message.data),
      type: message.type ?? "text",
      ...(message.delayMs === undefined ? {} : { delayMs: message.delayMs }),
    }))
    const dispatcher = this.deps.http.dispatcherFor(url.replace(/^ws/i, "http"), sslVerify)
    const subprotocols = (config["subprotocols"] as readonly string[] | undefined) ?? []
    return {
      adapter: new WebsocketAdapter({
        url, headers, signal, timeoutMs: timeout * 1000, dispatcher, subprotocols, messages: outbound,
      }),
      request: { method: "GET", url },
      maxMessages: (config["maxMessages"] as number | undefined) ?? 1,
      finishConditions: (config["finishConditions"] as readonly StreamFinishCondition[] | undefined) ?? [],
      extractors: config["extractors"] as Record<string, string> | undefined,
      unresolvedPlaceholders: collectUnresolvedPlaceholders([url, ...Object.values(headers), ...Object.values(queryParams), ...outbound.map((message) => message.data)]),
    }
  }

  /**
   * A gRPC server-streaming node. The request is resolved exactly as a unary
   * call's is; the adapter then opens the call and yields its decoded
   * responses, and the final status and trailers land on the result.
   */
  private async prepareGrpcStream(node: WorkflowNode, signal: AbortSignal): Promise<PreparedStream> {
    const prepared = await this.prepareGrpcCall(node, signal)
    if ("failure" in prepared) {
      const failure = prepared.failure
      throw new StreamHandshakeError(failure.error ?? "gRPC call could not be prepared", {
        method: "GRPC",
        url: String(failure["target"] ?? ""),
        ...(failure.statusCode === undefined ? {} : { statusCode: failure.statusCode }),
        ...(failure.headers === undefined ? {} : { headers: failure.headers }),
        ...(failure.body === undefined ? {} : { body: failure.body }),
      })
    }
    const { call, extractors, expectedStatus } = prepared
    const config = node.config ?? {}
    return {
      adapter: new GrpcStreamAdapter({
        connection: call.connection,
        source: call.source,
        service: call.service,
        method: call.method,
        message: call.message,
        metadata: call.metadata,
        deadlineMs: call.deadlineMs,
        signal,
        ...(expectedStatus === undefined ? {} : { expectedStatus }),
      }),
      request: { method: "GRPC", url: call.target, target: call.target, rpc: call.rpc },
      // A server stream naturally ends, so its default capture is the whole
      // call (bounded by the 1 MiB capture limit), not SSE's one-event probe.
      maxMessages: (config["maxMessages"] as number | undefined) ?? 1000,
      finishConditions: (config["finishConditions"] as readonly StreamFinishCondition[] | undefined) ?? [],
      extractors,
      unresolvedPlaceholders: call.unresolvedPlaceholders,
    }
  }

  private completeStreamNode(
    node: WorkflowNode,
    result: NodeResult,
    startedAt: string,
    secretRefs: readonly string[],
    extractors?: Record<string, string>,
  ): NodeResult {
    if (this.cancelSignal?.aborted && result.status !== "success") {
      return this.recordCancelledNode(node.nodeId, { ...result, type: node.type, startedAt, secretRefs })
    }
    const withExtractors = extractors
      ? { ...result, extractorOutcomes: this.extractVariables(node.nodeId, extractors, result) }
      : result
    const failed = withExtractors.status === "error" || withExtractors.status === "client_error" || withExtractors.status === "server_error"
    const completed: NodeResult = { ...withExtractors, type: node.type, startedAt, completedAt: this.deps.clock.isoNow(), secretRefs }
    this.results.set(node.nodeId, completed)
    this.updateNodeStatus(node.nodeId, failed ? "failed" : "passed", completed)
    if (failed) {
      this.hasFailures = true
      this.failedNodes.add(node.nodeId)
      if (!this.firstErrorMessage) this.firstErrorMessage = completed.error ?? `Node ${node.nodeId} failed`
    }
    return completed
  }

  /**
   * The one finish-rule evaluator for every stream node. Every path resolves
   * through `resolveExtractorPath` (dot paths and `$` JSONPath alike) against
   * the normalized message, whose text `data` is parsed as JSON when it can be.
   */
  private streamMessageMatches(message: StreamMessage, conditions: readonly StreamFinishCondition[]): boolean {
    let data: unknown = message["data"]
    if (typeof data === "string" && message["type"] !== "binary") {
      try {
        data = JSON.parse(data) as unknown
      } catch {
        // Non-JSON data is still matchable as the raw string.
      }
    }
    const value = { ...message, data }
    return conditions.every((condition) => {
      const expected = this.resolveAssertionExpected(toAssertionOperator(condition.operator), condition.expectedValue)
      if (expected.state === "unresolved-template") return false
      try {
        // A query path is rooted at the whole message; a dot path reads off the
        // same value. Both go through the shared resolver's grammar.
        const actual = isQueryPath(condition.path)
          ? this.resolveQueryPathValue(value, condition.path)
          : this.getNestedValue(value, condition.path)
        return this.compareValues(actual, condition.operator, expected.value)
      } catch {
        return false
      }
    })
  }

  private async traverseStreamCompleteEdges(
    node: WorkflowNode,
    nodes: Map<string, WorkflowNode>,
    edges: readonly WorkflowEdge[],
    cancelSignal: AbortSignal | undefined,
  ): Promise<void> {
    const completeEdges = edges.filter((edge) => edge.source === node.nodeId && edge.sourceHandle === "complete")
    const tasks = completeEdges.map(async (edge) => {
      const target = nodes.get(edge.target)
      if (!target) return
      if (target.type === "end") {
        this.updateNodeStatus(target.nodeId, "passed")
        return
      }
      await this.executeFromNode(target.nodeId, nodes, edges, cancelSignal)
    })
    await Promise.allSettled(tasks)
  }

  private abortStreamListeners(): void {
    for (const controller of this.streamListeners.values()) controller.abort()
  }

  private async waitForStreamTasks(): Promise<void> {
    while (this.streamTasks.size > 0) {
      await Promise.allSettled([...this.streamTasks])
    }
  }

  // -------------------- Delay --------------------

  private async executeDelay(node: WorkflowNode, cancelSignal?: AbortSignal): Promise<NodeResult> {
    const config = node.config ?? {}
    const baseDurationMs = (config["duration"] as number | undefined) ?? 1000
    const jitter = config["jitter"] as { minMs?: number; maxMs?: number } | undefined
    const durationMs =
      jitter && jitter.maxMs !== undefined && jitter.minMs !== undefined && jitter.maxMs >= jitter.minMs
        ? jitter.minMs + Math.floor(this.deps.rng.next() * (jitter.maxMs - jitter.minMs + 1))
        : baseDurationMs

    if (this.deps.baseUrl) {
      return { status: "success", duration: 0, message: "Delayed for 0 ms (harness mode)" }
    }

    if (!(await waitFor(durationMs, cancelSignal))) return { status: "cancelled", duration: 0, message: "Delay cancelled" }
    return { status: "success", duration: durationMs, message: `Delayed for ${durationMs} ms` }
  }

  // -------------------- Assertion --------------------

  private async executeAssertion(node: WorkflowNode, edges: readonly WorkflowEdge[]): Promise<NodeResult> {
    const config = node.config ?? {}
    type AssertionDef = {
      readonly field?: string
      readonly path?: string
      readonly operator: string
      readonly expected?: unknown
      readonly expectedValue?: unknown
      readonly source?: string
    }

    const configured = config["assertions"]
    let assertions: readonly AssertionDef[] = Array.isArray(configured) ? configured as AssertionDef[] : []

    // Read compatibility for configs saved before assertions became an array.
    if (assertions.length === 0) {
      const path = (config["path"] as string | undefined) ?? (config["field"] as string | undefined)
      const operator = config["operator"] as string | undefined
      if (path !== undefined && operator !== undefined) {
        assertions = [{
          path,
          operator,
          expected: config["expected"],
          source: (config["source"] as string | undefined) ?? "prev",
        }]
      }
    }

    if (assertions.length === 0) {
      return {
        status: "success",
        assertionOutcome: "pass",
        message: "No assertions configured",
        assertionEvaluations: [],
      }
    }

    await this.prepareRules(assertions)
    const evaluations: AssertionEvaluation[] = []
    const failureMode = config["failureMode"] === "all" ? "all" : "first"
    let stopped = false

    for (let index = 0; index < assertions.length; index++) {
      const assertion = assertions[index]!
      if (stopped) {
        evaluations.push(this.buildSkippedAssertionEvaluation(index, assertion))
        continue
      }

      const evaluation = this.evaluateAssertion(index, assertion, () => this.resolveAssertionResponseSource(node.nodeId, edges))
      evaluations.push(evaluation)
      if (evaluation.outcome === "fail" && failureMode === "first") stopped = true
    }

    const failedCount = evaluations.filter((evaluation) => evaluation.outcome === "fail").length
    if (failedCount > 0) {
      return {
        status: "failed",
        assertionOutcome: "fail",
        message: `Assertion failed: ${failedCount}/${assertions.length} rules failed`,
        assertionEvaluations: evaluations,
      }
    }

    return {
      status: "success",
      assertionOutcome: "pass",
      message: `All ${assertions.length} assertions passed`,
      assertionEvaluations: evaluations,
    }
  }

  /** One rule against the response `resolveSource` locates (an assertion node's upstream request, or a retrying node's own attempt). */
  private evaluateAssertion(
    ruleIndex: number,
    assertion: {
      readonly field?: string
      readonly path?: string
      readonly operator: string
      readonly expected?: unknown
      readonly expectedValue?: unknown
      readonly source?: string
    },
    resolveSource: () => AssertionResponseSource,
  ): AssertionEvaluation {
    const source = toAssertionSource(assertion.source)
    const path = assertion.path ?? assertion.field ?? ""
    const operator = toAssertionOperator(assertion.operator)
    const rawExpected = assertion.expectedValue !== undefined ? assertion.expectedValue : assertion.expected
    const expected = this.resolveAssertionExpected(operator, rawExpected)
    const base = {
      ruleIndex,
      source,
      path,
      operator,
      expectedState: expected.state,
      expectedType: jsonValueType(expected.value),
    } as const

    if (expected.state === "unresolved-template") {
      return {
        ...base,
        sourceNodeId: null,
        actualState: "not-evaluated",
        actualType: null,
        outcome: "fail",
        reasonCode: "template-unresolved",
      }
    }

    let actual: unknown
    let sourceNodeId: string | null = null
    if (source === "variables") {
      actual = this.workflowVariables[path]
    } else {
      const resolution = resolveSource()
      if (resolution.state !== "resolved") {
        return {
          ...base,
          sourceNodeId: null,
          actualState: resolution.state,
          actualType: null,
          outcome: "fail",
          reasonCode: resolution.state === "ambiguous-source" ? "ambiguous-source" : "source-unavailable",
        }
      }

      sourceNodeId = resolution.nodeId
      actual = this.readAssertionActual(source, path, resolution.result)
    }

    const evaluated = { ...base, sourceNodeId, actualState: actual === undefined ? "missing" : "present", actualType: jsonValueType(actual) } as const
    return this.compareAssertion(evaluated, actual, expected.value)
  }

  /** The verdict on `actual` once it was read; `evaluated` is everything else the evaluation reports. */
  private compareAssertion(
    evaluated: Omit<AssertionEvaluation, "outcome" | "reasonCode" | "detail" | "schemaErrors">,
    actual: unknown,
    expected: unknown,
  ): AssertionEvaluation {
    const operator = evaluated.operator
    try {
      const violations = operator === "matchesSchema" ? this.schemaCheck(actual, expected) : null
      const passed = violations ? violations.length === 0 : this.compareValues(actual, operator, expected)
      return {
        ...evaluated,
        outcome: passed ? "pass" : "fail",
        reasonCode: passed ? "passed" : "comparison-failed",
        ...(violations && violations.length > 0
          ? {
              detail: `${violations.length} schema violation${violations.length === 1 ? "" : "s"}`,
              schemaErrors: violations.slice(0, MAX_SCHEMA_VIOLATIONS),
            }
          : {}),
      }
    } catch (error) {
      return {
        ...evaluated,
        outcome: "fail",
        reasonCode: "comparison-error",
        // The engine's own words for a bad pattern or schema; they carry the rule's text, not the response's.
        ...(error instanceof Error ? { detail: error.message.slice(0, 300) } : {}),
      }
    }
  }

  /** The value a rule on a response `source` reads from `result`. */
  private readAssertionActual(source: AssertionSource, path: string, result: NodeResult): unknown {
    if (source === "prev") {
      // A `$`-prefixed path is JSONPath rooted at the node result; a dot path
      // strips the optional `response.` prefix and reads the rest off the
      // result directly. Both address the same value.
      if (isQueryPath(path)) {
        const resolution = resolveExtractorPath(result, path)
        return resolution.failureReason === null ? resolution.value : undefined
      }
      return this.getNestedValue(result, path.startsWith("response.") ? path.slice(9) : path)
    }
    if (source === "headers") return this.getResponseHeader(result, path)
    if (source === "cookies") return this.getResponseCookie(result, path)
    return result.statusCode
  }

  /** Loads the regex sandbox when one of `rules` matches a regular expression (a schema may hold `pattern`s). */
  private async prepareRules(rules: readonly { readonly operator?: string }[]): Promise<void> {
    if (this.regex === null && rules.some((rule) => rule.operator === "matches" || rule.operator === "notMatches" || rule.operator === "matchesSchema")) {
      this.regex = await RegexSandbox.load()
    }
  }

  /** Where `actual` breaks `schema`; empty when it matches. A missing value is one violation. Throws on a schema that is not one. */
  private schemaCheck(actual: unknown, schema: unknown): SchemaViolation[] {
    if (actual === undefined) return [{ path: "", message: "Value is missing." }]
    if (this.regex === null) throw new Error("Regular expressions were not loaded for this rule")
    let validator = this.schemaValidators.get(schema)
    if (validator === undefined) {
      const parsed = parseSchemaValue(schema)
      if (parsed === null) throw new Error("Expected value is not a JSON Schema object")
      validator = compileSchema(parsed)
      this.schemaValidators.set(schema, validator)
    }
    return schemaViolations(validator, actual, this.regex)
  }

  private buildSkippedAssertionEvaluation(
    ruleIndex: number,
    assertion: {
      readonly field?: string
      readonly path?: string
      readonly operator: string
      readonly expected?: unknown
      readonly expectedValue?: unknown
      readonly source?: string
    },
  ): AssertionEvaluation {
    const operator = toAssertionOperator(assertion.operator)
    const rawExpected = assertion.expectedValue !== undefined ? assertion.expectedValue : assertion.expected
    const expected = this.resolveAssertionExpected(operator, rawExpected)
    return {
      ruleIndex,
      source: toAssertionSource(assertion.source),
      path: assertion.path ?? assertion.field ?? "",
      operator,
      sourceNodeId: null,
      expectedState: expected.state,
      expectedType: jsonValueType(expected.value),
      actualState: "not-evaluated",
      actualType: null,
      outcome: "skipped",
      reasonCode: "skipped-after-failure",
    }
  }

  private resolveAssertionExpected(
    operator: AssertionOperator,
    rawExpected: unknown,
  ): {
    readonly state: AssertionEvaluation["expectedState"]
    readonly value: unknown
  } {
    if (operator === "exists" || operator === "notExists") {
      return { state: "not-required", value: undefined }
    }
    if (typeof rawExpected !== "string" || !rawExpected.includes("{{")) {
      return { state: "literal", value: rawExpected }
    }
    const value = this.substituteVariables(rawExpected)
    return value.includes("{{")
      ? { state: "unresolved-template", value: undefined }
      : { state: "resolved-template", value }
  }

  // fallow-ignore-next-line complexity -- this breadth-first walk must distinguish missing, ambiguous, and completed response sources before an assertion can safely read prior output.
  private resolveAssertionResponseSource(
    assertionNodeId: string,
    edges: readonly WorkflowEdge[],
  ): AssertionResponseSource {
    const queue = edges.filter((edge) => edge.target === assertionNodeId).map((edge) => edge.source)
    const visited = new Set<string>()
    const sourceIds = new Set<string>()

    while (queue.length > 0) {
      const nodeId = queue.shift()!
      if (visited.has(nodeId)) continue
      visited.add(nodeId)
      const node = this.workflowNodes.get(nodeId)
      if (isResponseNodeType(node?.type)) {
        sourceIds.add(nodeId)
        continue
      }
      for (const edge of edges) {
        if (edge.target === nodeId) queue.push(edge.source)
      }
    }

    if (sourceIds.size !== 1) {
      return { state: sourceIds.size > 1 ? "ambiguous-source" : "source-unavailable" }
    }
    const nodeId = [...sourceIds][0]!
    const result = this.results.get(nodeId)
    return result !== undefined && isResponseNodeType(result.type)
      ? { state: "resolved", nodeId, result }
      : { state: "source-unavailable" }
  }

  /** Case-insensitive lookup of a response header value. */
  private getResponseHeader(result: NodeResult, name: string): string | undefined {
    const headers = result.headers ?? result.response?.headers ?? {}
    const target = name.trim().toLowerCase()
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() === target) return value
    }
    return undefined
  }

  /** Value of a Set-Cookie cookie by name, from the last response (one Set-Cookie per line, see `toHeaderRecord`). */
  private getResponseCookie(result: NodeResult, name: string): string | undefined {
    const raw = this.getResponseHeader(result, "set-cookie")
    if (!raw) return undefined
    const target = name.trim()
    for (const part of raw.split("\n")) {
      const pair = part.split(";")[0] ?? ""
      const eq = pair.indexOf("=")
      if (eq === -1) continue
      if (pair.slice(0, eq).trim() === target) return pair.slice(eq + 1).trim()
    }
    return undefined
  }

  private compareValues(actual: unknown, operator: string, expected: unknown): boolean {
    if (operator === "exists") return actual !== null && actual !== undefined
    if (operator === "notExists") return actual === null || actual === undefined
    if (operator === "matches" || operator === "notMatches") {
      // A missing value neither matches nor fails to: the rule fails either way.
      if (actual === null || actual === undefined) return false
      if (this.regex === null) throw new Error("Regular expressions were not loaded for this rule")
      const text = typeof actual === "object" ? JSON.stringify(actual) : String(actual)
      return this.regex.test(String(expected), text) === (operator === "matches")
    }
    if (operator === "type") return valueHasType(actual, expected)
    if (operator === "matchesSchema") return this.schemaCheck(actual, expected).length === 0
    if (operator === "equals" && (actual == null || expected == null)) return actual === expected
    if (operator === "notEquals" && (actual == null || expected == null)) return actual !== expected

    if (operator === "count") {
      let actualCount: number
      if (Array.isArray(actual) || typeof actual === "string") {
        actualCount = actual.length
      } else if (typeof actual === "object" && actual !== null) {
        actualCount = Object.keys(actual).length
      } else {
        actualCount = actual !== null && actual !== undefined ? Number(actual) : 0
      }
      const expectedCount = expected !== null && expected !== undefined ? Number(expected) : 0
      return actualCount === expectedCount
    }

    if (Array.isArray(actual) || (typeof actual === "object" && actual !== null && !Array.isArray(actual))) {
      if (["gt", "gte", "lt", "lte", "equals", "notEquals"].includes(operator)) {
        actual = Array.isArray(actual) ? actual.length : Object.keys(actual).length
      }
    }

    let expectedNum: number | null = null
    let actualNum: number | null = null
    try {
      if (expected !== null && expected !== undefined) {
        const n = Number(expected)
        if (!Number.isNaN(n)) expectedNum = n
      }
      if (actual !== null && actual !== undefined) {
        const n = Number(actual)
        if (!Number.isNaN(n)) actualNum = n
      }
    } catch {
      expectedNum = null
      actualNum = null
    }

    const actualStr = actual !== null && actual !== undefined ? String(actual) : ""
    const expectedStr = expected !== null && expected !== undefined ? String(expected) : ""

    switch (operator) {
      case "equals":
        if (expectedNum !== null && actualNum !== null) return actualNum === expectedNum
        return actualStr === expectedStr
      case "notEquals":
        if (expectedNum !== null && actualNum !== null) return actualNum !== expectedNum
        return actualStr !== expectedStr
      case "contains":
        return actualStr.includes(expectedStr)
      case "notContains":
        return !actualStr.includes(expectedStr)
      case "gt":
        return expectedNum !== null && actualNum !== null && actualNum > expectedNum
      case "gte":
        return expectedNum !== null && actualNum !== null && actualNum >= expectedNum
      case "lt":
        return expectedNum !== null && actualNum !== null && actualNum < expectedNum
      case "lte":
        return expectedNum !== null && actualNum !== null && actualNum <= expectedNum
      default:
        throw new Error(`Unknown operator: ${operator}`)
    }
  }

  // -------------------- Merge --------------------

  private async executeMerge(node: WorkflowNode, edges: readonly WorkflowEdge[], cancelSignal?: AbortSignal): Promise<NodeResult> {
    const config = node.config ?? {}
    const mergeStrategy = (config["mergeStrategy"] as string | undefined) ?? "all"
    const nodeId = node.nodeId

    if (this.mergeCompleted.has(nodeId)) {
      return { status: "success", mergedByOther: true }
    }

    const incomingEdges = edges.filter((e) => e.target === nodeId)
    const predecessorNodeIds = incomingEdges.map((e) => e.source)
    // On a rerun a predecessor outside the scope never runs: its seeded result
    // is all it will ever have, and without a passing one it counts as failed.
    const settledBySource = (id: string): boolean => this.resumeScope !== null && !this.resumeScope.has(id)
    const waitingOn = (): string[] =>
      predecessorNodeIds.filter((id) => !this.results.has(id) && !this.failedNodes.has(id) && !settledBySource(id))

    if (mergeStrategy === "all" || mergeStrategy === "conditional") {
      let missing = waitingOn()
      if (missing.length > 0) {
        const maxWait = 30000
        const waitInterval = 100
        let elapsed = 0
        while (missing.length > 0 && elapsed < maxWait && !cancelSignal?.aborted) {
          await new Promise((resolve) => setTimeout(resolve, waitInterval))
          elapsed += waitInterval
          missing = waitingOn()
        }
        if (cancelSignal?.aborted) throw new Error("Merge cancelled")
        if (missing.length > 0) {
          throw new Error(`Timeout waiting for predecessors: ${missing.join(", ")}`)
        }
      }

      const failed = predecessorNodeIds.filter((id) =>
        this.failedNodes.has(id) || (settledBySource(id) && this.results.get(id)?.status !== "success"))
      if (failed.length > 0) {
        throw new Error(`Cannot merge: ${failed.length} predecessor(s) failed`)
      }
    } else if (mergeStrategy === "any" || mergeStrategy === "first") {
      const completed = predecessorNodeIds.filter((id) => this.results.has(id))
      if (completed.length === 0) {
        throw new Error(`All ${predecessorNodeIds.length} branches failed or timed out`)
      }
    }

    if (mergeStrategy === "conditional") {
      this.evaluateMergeConditions(config, predecessorNodeIds, edges)
    }

    this.mergeCompleted.add(nodeId)

    const predecessorResults = this.mergeBranchResults(nodeId, edges)
    this.branchResults.set(nodeId, predecessorResults)

    return {
      status: "success",
      message: `Merged ${predecessorResults.length} branches using '${mergeStrategy}' strategy`,
      mergeStrategy,
      branchCount: predecessorResults.length,
    }
  }

  // -------------------- Call Workflow --------------------

  /**
   * Runs a target workflow in-process to completion and maps its outputs back
   * onto the caller's variable scope.
   *
   * The sub-execution gets its own Run row against the *target* workflow (via
   * `deps.subRun`), so opening the callee and clicking History shows what
   * actually happened inside a failed call. Its node statuses and per-node
   * results land on that child run — they used to be written onto the caller's
   * run under node ids that don't exist in the caller's graph.
   *
   * The caller's own node result still carries the summary only (status,
   * node/failure counts, output variable names, child run id), never the
   * sub-workflow's raw per-node results: those carry unredacted
   * request/response detail, and the caller's `sanitizeRunResults` pass only
   * walks its own top-level results array.
   */
  private async executeCallWorkflow(node: WorkflowNode, cancelSignal?: AbortSignal): Promise<NodeResult> {
    const config = (node.config ?? {}) as WorkflowCallConfig
    const targetWorkflowId = config.targetWorkflowId
    if (!targetWorkflowId) {
      return { status: "error", error: "Call Workflow node has no target workflow configured" }
    }
    if (!this.deps.resolveWorkflow) {
      return { status: "error", error: "Sub-workflow execution is not available in this context" }
    }
    if (this.callDepth >= WorkflowExecutor.MAX_CALL_DEPTH) {
      return { status: "error", error: "Call Workflow recursion depth exceeded" }
    }
    const target = this.deps.resolveWorkflow(targetWorkflowId)
    if (!target) {
      return { status: "error", error: `Called workflow ${targetWorkflowId} not found` }
    }

    const inputMapping = config.inputMapping ?? {}
    const outputMapping = config.outputMapping ?? {}

    return config.forEach
      ? this.executeForEach(targetWorkflowId, target, inputMapping, outputMapping, config.forEach, cancelSignal)
      : this.executeSingleCall(targetWorkflowId, target, inputMapping, outputMapping, cancelSignal)
  }

  /**
   * Run the target once, mapping inputs in and outputs back out. This is the
   * pre-for-each path: one child run, one summary. `forEach` calls reuse the
   * same per-iteration mechanics via `runChildIteration`.
   */
  private async executeSingleCall(
    targetWorkflowId: string,
    target: ResolvedSubWorkflow,
    inputMapping: Record<string, string>,
    outputMapping: Record<string, string>,
    cancelSignal?: AbortSignal,
  ): Promise<NodeResult> {
    const inputVariables = this.resolveInputVariables(inputMapping)
    const { output, runId } = await this.runChildIteration(targetWorkflowId, target, inputVariables, cancelSignal)
    const childOutput = output

    for (const [callerVarName, subVarName] of Object.entries(outputMapping)) {
      if (subVarName in childOutput.extractedVariables) {
        this.workflowVariables[callerVarName] = childOutput.extractedVariables[subVarName]
      }
    }

    const targetLabel = target.name ?? targetWorkflowId
    return {
      status: childOutput.status === "passed" ? "success" : "error",
      message:
        childOutput.status === "passed"
          ? `Sub-workflow ${targetLabel} completed`
          : `Sub-workflow ${targetLabel} failed in ${childOutput.failedNodes.length} node(s)`,
      subWorkflow: {
        workflowId: targetWorkflowId,
        ...(runId ? { runId } : {}),
        status: childOutput.status,
        nodeCount: target.nodes.length,
        failedNodeCount: childOutput.failedNodes.length,
        outputVariableNames: Object.keys(outputMapping),
      },
    }
  }

  /**
   * Run the target once per item in `forEach.items`, bounded by the iteration
   * cap and `concurrency`, and collect each output variable into an array in
   * item order.
   *
   * The node passes only when every iteration passes. With `stopOnFailure`
   * (the default) it stops starting new iterations at the first failure;
   * otherwise it runs every item and the summary reports how many failed. Each
   * iteration is its own sub-run of the target, recorded via `deps.subRun`, so
   * the callee's History holds one entry per item.
   */
  private async executeForEach(
    targetWorkflowId: string,
    target: ResolvedSubWorkflow,
    inputMapping: Record<string, string>,
    outputMapping: Record<string, string>,
    forEach: WorkflowCallForEachConfig,
    cancelSignal?: AbortSignal,
  ): Promise<NodeResult> {
    const items = this.resolveItems(forEach.items)
    if (items === null) {
      return { status: "error", error: "For-each items did not resolve to an array" }
    }
    if (!forEach.itemVariable?.trim()) {
      return { status: "error", error: "For-each item variable is required" }
    }
    const capped = items.slice(0, WORKFLOW_CALL_FOR_EACH_MAX_ITERATIONS)
    const concurrency = Math.min(
      Math.max(Math.trunc(forEach.concurrency ?? 1), 1),
      WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY,
    )
    const stopOnFailure = forEach.stopOnFailure ?? true

    // The input mapping is resolved once in the caller's context: it does not
    // depend on the item, which arrives through the item/index variables.
    const baseInput = this.resolveInputVariables(inputMapping)

    const outcomes: ForEachIterationOutcome[] = []
    let cancelled = false
    let stopRequested = false
    let nextIndex = 0

    const worker = async (): Promise<void> => {
      while (!stopRequested && !cancelled && !cancelSignal?.aborted) {
        const index = nextIndex
        nextIndex += 1
        if (index >= capped.length) return

        const inputVariables = { ...baseInput }
        if (forEach.itemVariable) inputVariables[forEach.itemVariable] = capped[index]
        if (forEach.indexVariable) inputVariables[forEach.indexVariable] = index

        const { output, runId } = await this.runChildIteration(targetWorkflowId, target, inputVariables, cancelSignal)
        const outcome: ForEachIterationOutcome = {
          index,
          status: output.status,
          output,
          ...(runId ? { runId } : {}),
        }
        outcomes[index] = outcome
        if (outcome.status === "cancelled") {
          cancelled = true
          stopRequested = true
        } else if (outcome.status === "failed" && stopOnFailure) {
          stopRequested = true
        }
      }
    }

    await Promise.all(
      Array.from({ length: Math.min(concurrency, capped.length) }, () => worker()),
    )

    // Collect output variables into arrays in item order; a slot is `null`
    // where an iteration did not run (early stop/cancel) or did not produce
    // the variable.
    for (const callerVarName of Object.keys(outputMapping)) {
      const collected: unknown[] = []
      for (let i = 0; i < capped.length; i++) {
        const outcome = outcomes[i]
        const value = outcome?.output?.extractedVariables[outputMapping[callerVarName]!]
        collected.push(value === undefined ? null : value)
      }
      this.workflowVariables[callerVarName] = collected
    }

    const iterations = outcomes.filter((o): o is ForEachIterationOutcome => o !== undefined)
    const failedCount = iterations.filter((o) => o.status === "failed").length
    const ranCount = iterations.length
    const allPassed = failedCount === 0 && ranCount === capped.length

    const targetLabel = target.name ?? targetWorkflowId
    const summary = (): NonNullable<NodeResult["subWorkflow"]> => ({
      workflowId: targetWorkflowId,
      status: cancelled ? "cancelled" : allPassed ? "passed" : "failed",
      nodeCount: target.nodes.length,
      failedNodeCount: 0,
      outputVariableNames: Object.keys(outputMapping),
      forEach: {
        itemCount: capped.length,
        ranCount,
        failedCount,
        iterations: iterations.map((o) => ({
          index: o.index,
          ...(o.runId ? { runId: o.runId } : {}),
          status: o.status,
        })),
      },
    })

    if (cancelled) {
      return { status: "cancelled", message: `Sub-workflow ${targetLabel} cancelled`, subWorkflow: summary() }
    }
    if (allPassed) {
      return {
        status: "success",
        message: `Sub-workflow ${targetLabel} completed ${ranCount} iteration(s)`,
        subWorkflow: summary(),
      }
    }
    const firstFailed = iterations.find((o) => o.status === "failed")
    const message = stopOnFailure
      ? `Sub-workflow ${targetLabel} failed in iteration ${(firstFailed?.index ?? 0) + 1}`
      : `Sub-workflow ${targetLabel}: ${failedCount} of ${ranCount} iteration(s) failed`
    return { status: "error", message, subWorkflow: summary() }
  }

  /**
   * Run the target once as a child, returning its output and the child run id.
   * Never rejects: an unexpected throw is folded into a `failed` outcome, and
   * the child run row is always finished.
   */
  private async runChildIteration(
    targetWorkflowId: string,
    target: ResolvedSubWorkflow,
    inputVariables: Record<string, unknown>,
    cancelSignal?: AbortSignal,
  ): Promise<{ output: ExecutorOutput; runId?: string }> {
    const sub = this.deps.subRun?.begin(targetWorkflowId)
    const childExecutor = new WorkflowExecutor({ ...(sub?.deps ?? this.deps), cookieJar: this.cookieJar })
    childExecutor.callDepth = this.callDepth + 1
    let output: ExecutorOutput | undefined
    try {
      output = await childExecutor.executeWorkflow(
        {
          nodes: target.nodes,
          edges: target.edges,
          variables: { ...(target.variables ?? {}), ...inputVariables },
        },
        {
          ...(sub ? { runId: sub.runId } : {}),
          ...(cancelSignal ? { cancelSignal } : {}),
        },
      )
    } catch (error) {
      // `executeWorkflow` only rethrows non-StopBranch errors; treat them as a
      // failed child so the node's summary counts them rather than bubbling a
      // half-finished run to the caller.
      output = this.syntheticFailureOutput(error)
    } finally {
      // Runs on the throw path too, or a cancelled/erroring sub-execution
      // leaves its run row stuck in `running` until the next startup reconcile.
      if (sub) this.deps.subRun?.finish(sub.runId, output)
    }
    return { output: output ?? this.syntheticFailureOutput(undefined), ...(sub ? { runId: sub.runId } : {}) }
  }

  /** An `ExecutorOutput` standing in for a child that threw before producing one. */
  private syntheticFailureOutput(error: unknown): ExecutorOutput {
    return {
      status: "failed",
      startedAt: this.deps.clock.isoNow(),
      nodeStatuses: {},
      extractedVariables: {},
      outputs: {},
      results: [],
      failedNodes: [],
      failureMessage: error instanceof Error ? error.message : String(error),
    }
  }

  /**
   * Resolve an input mapping in the caller's context. Secrets are disallowed
   * here so a secret value is never downgraded into a plain child variable
   * when the child can already reach it directly and more safely via
   * {{secrets.*}}.
   */
  private resolveInputVariables(inputMapping: Record<string, string>): Record<string, unknown> {
    const inputVariables: Record<string, unknown> = {}
    for (const [targetVarName, sourceExpr] of Object.entries(inputMapping)) {
      inputVariables[targetVarName] = this.substituteVariables(sourceExpr, { allowSecrets: false })
    }
    return inputVariables
  }

  /**
   * Resolve `forEach.items`: a single `{{...}}` placeholder whose value is an
   * array, or a JSON array literal. Returns `null` when neither yields an
   * array.
   */
  private resolveItems(expr: string | undefined): readonly unknown[] | null {
    if (!expr) return null
    const trimmed = expr.trim()
    if (trimmed.startsWith("$")) {
      // JSONPath rooted at `{ variables, env, data, <nodeId>: result }`, the
      // same names the placeholders use: `$.variables.ids`, `$.fetch.response.body.items`.
      const root: Record<string, unknown> = {
        ...Object.fromEntries(this.results),
        variables: this.workflowVariables,
        env: this.environmentVariables,
        data: this.deps.data ?? {},
      }
      const resolution = resolveExtractorPath(root, trimmed)
      return resolution.failureReason === null && Array.isArray(resolution.value) ? resolution.value : null
    }
    const single = /^\{\{([^}]+)\}\}$/.exec(trimmed)
    if (single) {
      const value = this.resolvePlaceholderValue(single[1]!.trim())
      return Array.isArray(value) ? value : null
    }
    try {
      const parsed: unknown = JSON.parse(trimmed)
      return Array.isArray(parsed) ? parsed : null
    } catch {
      return null
    }
  }

  /** The raw (un-stringified) value a `{{...}}` path resolves to, or undefined. */
  private resolvePlaceholderValue(varPath: string): unknown {
    const scope = /^(env|variables|data)\.(.*)$/s.exec(varPath)
    if (scope) return this.readScopedValue(scope[1]!, scope[2]!)
    const firstPart = varPath.split(".")[0]!
    const nodeResult = this.results.get(firstPart)
    return nodeResult ? this.readRawPath(nodeResult, varPath.split(".").slice(1)) : undefined
  }

  /** Walk a scope map (`env`, `variables`, `data`) by dotted path, returning the raw value. */
  private readScopedValue(scopeName: string, path: string): unknown {
    const name = path.split(".")[0]!
    if (scopeName === "variables" && this.maskedSeedVariables.has(name) && !(name in this.workflowVariables)) {
      throw new Error(`${RERUN_REFUSED} {{variables.${name}}} was masked in the source run. Rerun from the node that sets it, or run the whole workflow.`)
    }
    let value: unknown =
      scopeName === "env" ? this.environmentVariables : scopeName === "variables" ? this.workflowVariables : this.deps.data
    for (const part of path.split(".")) {
      if (typeof value !== "object" || value === null) return undefined
      value = (value as Record<string, unknown>)[part]
    }
    return value
  }

  /** Walk an object/array by dotted path, returning the raw value (not stringified). */
  private readRawPath(value: unknown, pathParts: readonly string[]): unknown {
    let current: unknown = value
    for (const part of pathParts) {
      const arrayMatch = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/)
      if (arrayMatch) {
        const key = arrayMatch[1]!
        const index = Number.parseInt(arrayMatch[2]!, 10)
        if (typeof current === "object" && current !== null && key in current) {
          current = (current as Record<string, unknown>)[key]
          if (Array.isArray(current) && index >= 0 && index < current.length) current = current[index]
          else return undefined
        } else {
          return undefined
        }
      } else if (typeof current === "object" && current !== null) {
        current = (current as Record<string, unknown>)[part]
      } else {
        return undefined
      }
    }
    return current
  }

  /**
   * Gate a conditional merge: throws if the saved branch conditions do not
   * pass under the configured AND/OR logic. branchIndex is the zero-based
   * position in the incoming-edge order (matching the panel's "Branch index").
   */
  private evaluateMergeConditions(
    config: Record<string, unknown>,
    predecessorNodeIds: readonly string[],
    edges: readonly WorkflowEdge[],
  ): void {
    const raw = config["conditions"]
    const conditions = Array.isArray(raw)
      ? (raw as Array<{ branchIndex?: number; field?: string; operator?: string; value?: unknown }>)
      : []
    if (conditions.length === 0) return

    const branchResults = predecessorNodeIds.map((predId) =>
      this.results.get(this.findDataProducingAncestor(predId, edges)),
    )

    const outcome = (condition: (typeof conditions)[number]): boolean => {
      const branch = branchResults[condition.branchIndex ?? 0]
      if (!branch) return false
      const field = condition.field ?? ""
      const cleanPath = field.startsWith("response.") ? field.slice(9) : field
      const actual = this.getNestedValue(branch, cleanPath)
      const expected = this.substituteVariables(String(condition.value ?? ""))
      try {
        return this.compareValues(actual, condition.operator ?? "equals", expected)
      } catch {
        return false
      }
    }

    const logic = config["conditionLogic"] === "AND" ? "AND" : "OR"
    const outcomes = conditions.map(outcome)
    const passed = logic === "AND" ? outcomes.every(Boolean) : outcomes.some(Boolean)
    if (!passed) {
      throw new Error(`Conditional merge gate not satisfied (${logic}): branch conditions did not match`)
    }
  }

  /** The response each branch into a merge carried, in incoming-edge order. */
  private mergeBranchResults(nodeId: string, edges: readonly WorkflowEdge[]): Array<readonly [string, NodeResult]> {
    const branches: Array<readonly [string, NodeResult]> = []
    for (const edge of edges) {
      if (edge.target !== nodeId) continue
      const dataNodeId = this.findDataProducingAncestor(edge.source, edges)
      const result = this.results.get(dataNodeId)
      if (result && isResponseNodeType(result.type)) branches.push([dataNodeId, result])
    }
    return branches
  }

  private findDataProducingAncestor(nodeId: string, edges: readonly WorkflowEdge[]): string {
    const visited = new Set<string>()
    const visit = (id: string): string => {
      if (visited.has(id)) return id
      visited.add(id)
      const result = this.results.get(id)
      if (result && isResponseNodeType(result.type)) return id
      const incoming = edges.filter((e) => e.target === id)
      if (incoming.length === 0) return id
      if (incoming.length === 1) return visit(incoming[0]!.source)
      return id
    }
    return visit(nodeId)
  }

  // -------------------- Template substitution --------------------

  /**
   * Resolve every `{{...}}` placeholder in `text`. With `json`, `text` is a JSON
   * template and a placeholder inside a string literal is JSON-escaped (see
   * `substituteJsonTemplate`).
   */
  private substituteVariables(text: string, options: { allowSecrets?: boolean; json?: boolean } = {}): string {
    const allowSecrets = options.allowSecrets ?? true

    const resolve = (match: string, rawPath: string): string => {
      const varPath = rawPath.trim()

      const called = this.callPlaceholderFunction(varPath)
      if (called !== undefined) return called

      // Secrets
      if (varPath.startsWith("secrets.")) {
        if (!allowSecrets) {
          throw new Error("Secret substitution not allowed in URL/query/path contexts")
        }
        const value = this.deps.secrets?.[varPath.slice(8)]
        return value !== undefined ? value : match
      }

      // Environment variables, workflow variables, the iteration's data row
      const scope = /^(env|variables|data)\.(.*)$/s.exec(varPath)
      if (scope) return this.resolveScopedPlaceholder(scope[1]!, scope[2]!, match)

      if (varPath.startsWith("prev")) return this.resolvePrevPlaceholder(varPath, match)

      // Direct node ID access
      const firstPart = varPath.split(".")[0]!
      const nodeResult = this.results.get(firstPart)
      return nodeResult ? this.readResult(firstPart, nodeResult, varPath.split(".").slice(1), match) : match
    }

    return options.json ? substituteJsonTemplate(text, resolve) : text.replace(PLACEHOLDER_RE, resolve)
  }

  /** A `name(args)` placeholder's value; undefined when `varPath` is no call to a known function. */
  private callPlaceholderFunction(varPath: string): string | undefined {
    const funcMatch = varPath.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\((.*)\)$/)
    if (!funcMatch) return undefined
    const func = this.deps.functions.getFunction(funcMatch[1]!)
    if (!func) return undefined
    // A function that rejects its arguments fails the node with its own
    // message rather than sending the placeholder text verbatim.
    const params = funcMatch[2]!.trim()
    const paramList = params
      ? params.split(",").map((p) => p.trim().replace(/^["']|["']$/g, ""))
      : []
    return String(func(...paramList))
  }

  /** `{{env.…}}`, `{{variables.…}}` or `{{data.…}}`: `path` walked from the named scope. */
  private resolveScopedPlaceholder(scopeName: string, path: string, match: string): string {
    const name = path.split(".")[0]!
    if (scopeName === "variables" && this.maskedSeedVariables.has(name) && !(name in this.workflowVariables)) {
      throw new Error(`${RERUN_REFUSED} ${match} was masked in the source run. Rerun from the node that sets it, or run the whole workflow.`)
    }
    let value: unknown =
      scopeName === "env" ? this.environmentVariables : scopeName === "variables" ? this.workflowVariables : this.deps.data
    for (const part of path.split(".")) {
      if (typeof value !== "object" || value === null) return match
      value = (value as Record<string, unknown>)[part]
    }
    return value !== undefined && value !== null ? placeholderText(value) : match
  }

  /** `{{prev.…}}` reads the last result (a rerun entry's own predecessor); `{{prev[i].…}}` the i-th of the merged branches, else of all results. */
  private resolvePrevPlaceholder(varPath: string, match: string): string {
    const indexMatch = varPath.match(/^prev\[(\d+)\]\.(.+)$/)
    if (indexMatch) {
      const branchIndex = Number.parseInt(indexMatch[1]!, 10)
      const entries = this.currentBranchContext.length > 0 ? this.currentBranchContext : [...this.results.entries()]
      const entry = branchIndex >= 0 ? entries[branchIndex] : undefined
      return entry ? this.readResult(entry[0], entry[1], indexMatch[2]!.split("."), match) : match
    }

    const entryPrev = this.entryPrev.getStore()
    const last = entryPrev === undefined ? [...this.results.entries()].pop() : entryPrev
    return last ? this.readResult(last[0], last[1], varPath.slice(5).split("."), match) : match
  }

  /**
   * A path into a node's result. A result seeded from a rerun's source run is
   * the stored copy, so a value that was masked or cut short there is refused
   * rather than sent as `<SECRET>` or as half a body.
   */
  private readResult(nodeId: string, result: NodeResult, pathParts: string[], match: string): string {
    const text = this.resolveDottedPath(result, pathParts, match)
    if (!this.seededNodeIds.has(nodeId)) return text
    if (result.response?.truncated === true) {
      throw new Error(`${RERUN_REFUSED} ${match} reads node ${nodeId}'s response, which was too large to store whole in the source run`)
    }
    if (text.includes(SECRET_PLACEHOLDER)) {
      throw new Error(`${RERUN_REFUSED} ${match} was masked in the source run. Rerun from node ${nodeId}, or run the whole workflow.`)
    }
    return text
  }

  private resolveDottedPath(value: unknown, pathParts: string[], fallback: string): string {
    let current: unknown = value
    for (const part of pathParts) {
      const arrayMatch = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/)
      if (arrayMatch) {
        const key = arrayMatch[1]!
        const index = Number.parseInt(arrayMatch[2]!, 10)
        if (typeof current === "object" && current !== null && key in current) {
          current = (current as Record<string, unknown>)[key]
          if (Array.isArray(current) && index >= 0 && index < current.length) {
            current = current[index]
          } else {
            return fallback
          }
        } else {
          return fallback
        }
      } else if (typeof current === "object" && current !== null) {
        current = (current as Record<string, unknown>)[part]
      } else {
        return fallback
      }
    }
    return current !== undefined && current !== null ? placeholderText(current) : fallback
  }

  // -------------------- Extraction --------------------

  private extractVariables(
    producerNodeId: string,
    extractors: Record<string, string>,
    response: NodeResult,
  ): ExtractorOutcome[] {
    const outcomes: ExtractorOutcome[] = []
    for (const [varName, varPath] of Object.entries(extractors)) {
      try {
        const resolution = this.resolveExtractorValue(response, varPath)
        const value = resolution.value
        const matched = resolution.failureReason === null
        if (matched) {
          this.workflowVariables[varName] = value
        }
        outcomes.push({
          producerNodeId,
          variableName: varName,
          path: varPath,
          matched,
          observedType: jsonValueType(value),
          failureReason: resolution.failureReason,
        })
      } catch {
        outcomes.push({
          producerNodeId,
          variableName: varName,
          path: varPath,
          matched: false,
          observedType: null,
          failureReason: "path-missing",
        })
      }
    }
    return outcomes
  }

  private resolveExtractorValue(obj: unknown, path: string): ExtractorResolution {
    return resolveExtractorPath(obj, path)
  }

  /** Resolves a query path (JSONPath or XPath) against `data`, reading `undefined` when it fails. */
  private resolveQueryPathValue(data: unknown, path: string): unknown {
    const resolution = resolveExtractorPath(data, path)
    return resolution.failureReason === null ? resolution.value : undefined
  }

  private getNestedValue(obj: unknown, path: string): unknown {
    if (!obj || !path) return undefined
    const parts = path.split(".")
    let value: unknown = obj
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index]!
      const arrayMatch = part.match(/^([a-zA-Z_][a-zA-Z0-9_]*)\[(\d+)\]$/)
      if (arrayMatch) {
        const key = arrayMatch[1]!
        const index = Number.parseInt(arrayMatch[2]!, 10)
        if (typeof value === "object" && value !== null && key in value) {
          value = (value as Record<string, unknown>)[key]
          if (Array.isArray(value) && index >= 0 && index < value.length) {
            value = value[index]
          } else {
            return undefined
          }
        } else {
          return undefined
        }
      } else if (typeof value === "object" && value !== null) {
        value = (value as Record<string, unknown>)[part]
      } else {
        return undefined
      }
      if (value === undefined) return undefined
      if (value === null && index < parts.length - 1) return undefined
    }
    return value
  }

  // -------------------- Key-value field normalization --------------------

  private normalizeKeyValueField(
    pairs:
      | ReadonlyArray<{
          readonly key: string
          readonly value: string
          readonly active?: boolean
        }>
      | undefined,
  ): Record<string, string> {
    const result: Record<string, string> = {}
    if (!pairs) return result
    for (const entry of pairs) {
      if (entry === null || typeof entry !== "object") continue
      if (entry.active === false) continue
      const key = entry.key
      if (key === undefined || key === null || key === "") continue
      result[String(key)] = this.substituteVariables(String(entry.value ?? ""))
    }
    return result
  }

  // -------------------- HTTP auth / body construction --------------------

  /**
   * Apply the panel's auth config as an Authorization header or an apiKey
   * header/query entry. OAuth 2.0 fetches its token first; its failures are
   * thrown as `OAuthError` for the caller to report on the node.
   */
  private async applyAuthConfig(
    auth: HttpAuthConfig | undefined,
    headers: Record<string, string>,
    queryParams: Record<string, string>,
    context: AuthRequestContext,
  ): Promise<void> {
    if (!auth || !auth.type || auth.type === "none") return
    if (auth.type === "oauth2") {
      if (!auth.oauth2) throw new OAuthError("OAuth 2.0: the node has no OAuth 2.0 settings")
      headers["Authorization"] = `Bearer ${await this.oauthToken(auth.oauth2, context)}`
      return
    }
    if (auth.type === "jwt") {
      this.applyJwtAuth(auth.jwt, headers)
    } else if (auth.type === "bearer" && auth.bearer?.token) {
      headers["Authorization"] = `Bearer ${this.substituteVariables(auth.bearer.token)}`
    } else if (auth.type === "basic" && auth.basic) {
      const username = this.substituteVariables(auth.basic.username ?? "")
      const password = this.substituteVariables(auth.basic.password ?? "")
      headers["Authorization"] = `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
    } else if (auth.type === "apiKey") {
      this.applyApiKeyAuth(auth.apiKey, headers, queryParams)
    }
  }

  private applyApiKeyAuth(
    apiKey: HttpAuthConfig["apiKey"],
    headers: Record<string, string>,
    queryParams: Record<string, string>,
  ): void {
    if (!apiKey?.key) return
    const key = this.substituteVariables(apiKey.key)
    const value = this.substituteVariables(apiKey.value ?? "")
    if (apiKey.addTo === "query") {
      queryParams[key] = value
    } else {
      headers[key] = value
    }
  }

  private applyJwtAuth(jwt: JwtAuthConfig | undefined, headers: Record<string, string>): void {
    const token = this.signedJwt(jwt)
    // A fresh token per request, and as good as a password until it expires.
    this.deps.maskValue?.(token)
    const prefix = jwt?.prefix ?? "Bearer"
    headers[jwt?.headerName?.trim() || "Authorization"] = prefix ? `${prefix} ${token}` : token
  }

  private async oauthToken(oauth2: OAuth2AuthConfig, context: AuthRequestContext): Promise<string> {
    // The client secret and the token are the only places secrets may go, and
    // only as whole `{{secrets.NAME}}` references (the schema enforces it).
    const clientSecretName = secretNameOf(oauth2.clientSecret)
    const clientSecret = clientSecretName === undefined ? undefined : this.deps.secrets?.[clientSecretName]
    if (clientSecretName !== undefined && clientSecret === undefined) {
      throw new OAuthError(`OAuth 2.0: secret ${clientSecretName} is not set`)
    }
    const tokenSecretName = secretNameOf(oauth2.tokenSecret)
    const storedToken = tokenSecretName === undefined ? undefined : this.deps.secrets?.[tokenSecretName]
    const fill = (text: string | undefined): string | undefined =>
      text ? this.substituteVariables(text, { allowSecrets: false }) : undefined
    return oauthAccessToken(
      {
        grantType: oauth2.grantType,
        tokenUrl: fill(oauth2.tokenUrl) ?? "",
        clientId: fill(oauth2.clientId) ?? "",
        clientAuth: oauth2.clientAuth ?? "basic",
        ...(clientSecret === undefined ? {} : { clientSecret }),
        ...(oauth2.scope ? { scope: fill(oauth2.scope)! } : {}),
        ...(oauth2.audience ? { audience: fill(oauth2.audience)! } : {}),
        ...(tokenSecretName === undefined ? {} : { tokenSecretName }),
        ...(storedToken === undefined ? {} : { storedToken }),
      },
      {
        http: this.deps.http,
        cache: this.oauthTokens,
        now: this.deps.clock.now().getTime(),
        ...(context.signal ? { signal: context.signal } : {}),
        timeoutMs: context.timeoutMs,
        rejectUnauthorized: context.sslVerify,
        mask: (value) => this.deps.maskValue?.(value),
        ...(this.deps.saveSecret ? { save: this.deps.saveSecret } : {}),
      },
      context.forceRefresh,
    )
  }

  /**
   * The value of a `{{secrets.NAME}}` auth field; `scheme` names the auth in
   * the error. Absent and optional: undefined.
   */
  private authSecret(scheme: string, label: string, reference: string | undefined, required: boolean): string | undefined {
    const name = secretNameOf(reference)
    if (name === undefined) {
      if (required) throw new AuthError(`${scheme}: no ${label} secret is set on the node`)
      return undefined
    }
    const value = this.deps.secrets?.[name]
    if (value === undefined) throw new AuthError(`${scheme}: secret ${name} is not set`)
    return value
  }

  /** The JWT for one request: the payload and header filled as JSON templates, `iat` and `exp` added when absent. */
  private signedJwt(jwt: JwtAuthConfig | undefined): string {
    const key = this.authSecret("JWT", "signing key", jwt?.secret, true)!
    const object = (label: string, text: string | undefined): Record<string, unknown> => {
      if (!text?.trim()) return {}
      let value: unknown
      try {
        value = JSON.parse(this.substituteVariables(text, { json: true }))
      } catch {
        throw new AuthError(`JWT: the ${label} is not valid JSON`)
      }
      if (typeof value !== "object" || value === null || Array.isArray(value)) throw new AuthError(`JWT: the ${label} must be a JSON object`)
      return value as Record<string, unknown>
    }
    const claims = object("payload", jwt?.payload)
    const iat = typeof claims["iat"] === "number" ? claims["iat"] : Math.floor(this.deps.clock.now().getTime() / 1000)
    const payload = {
      ...claims,
      iat,
      ...(jwt?.expiresInSeconds !== undefined && claims["exp"] === undefined ? { exp: iat + jwt.expiresInSeconds } : {}),
    }
    return signJwt(jwt?.algorithm ?? "HS256", key, object("header", jwt?.header), payload)
  }

  /** Sign the request as it will be sent. A form-data body is encoded first, since the signature covers its bytes. */
  private async signAwsRequest(
    config: AwsSigV4AuthConfig | undefined,
    method: string,
    url: string,
    headers: Record<string, string>,
    body: string | Buffer | UndiciFormData | undefined,
  ): Promise<{ url: string; headers: Record<string, string>; body: string | Buffer | undefined }> {
    const scheme = "AWS Signature V4"
    const fill = (text: string | undefined): string => this.substituteVariables(text ?? "", { allowSecrets: false }).trim()
    const accessKeyId = this.substituteVariables(config?.accessKeyId ?? "").trim()
    const region = fill(config?.region)
    const service = fill(config?.service)
    if (!accessKeyId || !region || !service) throw new AuthError(`${scheme}: the access key ID, region and service are required`)
    const secretAccessKey = this.authSecret(scheme, "secret access key", config?.secretAccessKey, true)!
    const sessionToken = this.authSecret(scheme, "session token", config?.sessionToken, false)
    let bytes: string | Buffer | undefined
    const sent = { ...headers }
    if (body instanceof UndiciFormData) {
      const encoded = new UndiciResponse(body)
      bytes = Buffer.from(await encoded.arrayBuffer())
      for (const name of Object.keys(sent)) if (name.toLowerCase() === "content-type") delete sent[name]
      sent["Content-Type"] = encoded.headers.get("content-type") ?? ""
    } else {
      bytes = body
    }
    const signed = signAwsSigV4(
      { method, url, headers: sent, body: method.toUpperCase() === "GET" ? undefined : bytes, region, service, now: this.deps.clock.now() },
      { accessKeyId, secretAccessKey, ...(sessionToken === undefined ? {} : { sessionToken }) },
    )
    return { url: signed.url, headers: signed.headers, body: bytes }
  }

  /** Build the fetch body per `bodyType`, mutating `headers` with a Content-Type when one is implied. */
  private async buildHttpRequestBody(
    bodyType: string | undefined,
    body: string | Record<string, unknown> | undefined,
    headers: Record<string, string>,
    formDataEntries: readonly FormDataEntryLike[] | undefined,
    urlEncodedEntries: ReadonlyArray<{ readonly key: string; readonly value: string; readonly active?: boolean }> | undefined,
    fileUploads: readonly FileUploadLike[] | undefined,
  ): Promise<string | Buffer | UndiciFormData | undefined> {
    switch (bodyType) {
      case "none":
        return undefined

      case "form-data": {
        const form = new UndiciFormData()
        for (const entry of formDataEntries ?? []) {
          if (entry.active === false || !entry.key) continue
          if (entry.type === "file") {
            // ponytail: form-data file rows store a local file path in `value`
            // (see FormDataRows "file ref" placeholder) — read it directly.
            const buffer = await this.readFileUploadContent({ type: "path", value: entry.value })
            const fileName = entry.value.split(/[\\/]/).pop() || entry.key
            form.append(entry.key, new Blob([new Uint8Array(buffer)]), fileName)
          } else {
            form.append(entry.key, this.substituteVariables(entry.value ?? ""))
          }
        }
        return form
      }

      case "x-www-form-urlencoded": {
        const params = new URLSearchParams()
        for (const entry of urlEncodedEntries ?? []) {
          if (entry.active === false || !entry.key) continue
          params.append(entry.key, this.substituteVariables(entry.value ?? ""))
        }
        if (!headers["Content-Type"] && !headers["content-type"]) {
          headers["Content-Type"] = "application/x-www-form-urlencoded"
        }
        return params.toString()
      }

      case "binary": {
        const upload = fileUploads?.[0]
        if (!upload) return undefined
        const buffer = await this.readFileUploadContent(upload)
        if (!headers["Content-Type"] && !headers["content-type"] && upload.mimeType) {
          headers["Content-Type"] = upload.mimeType
        }
        return buffer
      }

      case "raw":
        return typeof body === "string"
          ? this.substituteVariables(body, { json: hasJsonContentType(headers) })
          : undefined

      case "json":
      default: {
        // Back-compat default for nodes saved before `bodyType` existed.
        if (body === undefined || body === null) return undefined
        // With no Content-Type the body is sent as application/json (below).
        const typed = Object.keys(headers).some((name) => name.toLowerCase() === "content-type")
        // An untyped string body (cURL and HAR imports) may be XML or a form:
        // escape for JSON only when it will be sent as JSON, as `raw` does.
        const isJson = bodyType === "json" || typeof body !== "string" || !typed || hasJsonContentType(headers)
        const json = this.substituteVariables(typeof body === "string" ? body : JSON.stringify(body), { json: isJson })
        // An empty field is no body at all, and claims no type.
        if (json.trim() !== "" && !typed) {
          headers["Content-Type"] = "application/json"
        }
        return json
      }
    }
  }

  /**
   * A GraphQL request per GraphQL over HTTP: a GET carries `query`,
   * `variables` (JSON) and `operationName` as query parameters; any other
   * method POSTs them as a JSON object. The variables are a JSON template, so
   * a placeholder inside a string is escaped and one standing alone can be a
   * number or an object.
   */
  private buildGraphqlRequest(
    graphql: GraphqlBody | undefined,
    method: string,
    headers: Record<string, string>,
    queryParams: Record<string, string>,
  ): string | undefined {
    const query = this.substituteVariables(graphql?.query ?? "")
    const variablesText = this.substituteVariables(graphql?.variables ?? "", { json: true })
    let variables: unknown
    if (variablesText.trim() !== "") {
      try {
        variables = JSON.parse(variablesText)
      } catch {
        throw new Error("GraphQL variables are not valid JSON")
      }
      if (typeof variables !== "object" || variables === null || Array.isArray(variables)) {
        throw new Error("GraphQL variables must be a JSON object")
      }
    }
    const operationName = graphql?.operationName?.trim() ? this.substituteVariables(graphql.operationName.trim()) : undefined
    if (method.toUpperCase() === "GET") {
      queryParams["query"] = query
      if (variables !== undefined) queryParams["variables"] = JSON.stringify(variables)
      if (operationName !== undefined) queryParams["operationName"] = operationName
      return undefined
    }
    if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json"
    }
    return JSON.stringify({ query, ...(variables === undefined ? {} : { variables }), ...(operationName === undefined ? {} : { operationName }) })
  }

  /**
   * A SOAP request: the envelope as XML, with the Content-Type the version
   * prescribes. SOAP 1.1 sends `text/xml` plus a `SOAPAction` header; SOAP 1.2
   * sends `application/soap+xml` with the action in the Content-Type parameter.
   * An explicit Content-Type or SOAPAction header on the node wins.
   */
  private buildSoapRequest(soap: SoapBody | undefined, headers: Record<string, string>): string {
    const envelope = this.substituteVariables(soap?.envelope ?? "").trim()
    if (envelope === "") throw new Error("SOAP envelope is required")
    const version = soap?.version ?? "1.1"
    const action = this.substituteVariables(soap?.action ?? "").trim()
    const hasHeader = (name: string): boolean => Object.keys(headers).some((key) => key.toLowerCase() === name)
    if (!hasHeader("content-type")) {
      headers["Content-Type"] = version === "1.2"
        ? `application/soap+xml; charset=utf-8${action === "" ? "" : `; action="${action.replace(/"/g, "")}"`}`
        : "text/xml; charset=utf-8"
    }
    if (version === "1.1" && !hasHeader("soapaction") && action !== "") {
      headers["SOAPAction"] = `"${action.replace(/"/g, "")}"`
    }
    return envelope
  }

  /**
   * A JSON-RPC 2.0 request, POSTed as application/json: `{jsonrpc:"2.0",
   * method, params?, id?}`. The params are a JSON template (object or array)
   * substituted JSON-aware, the same as a JSON body. A notification omits the
   * `id`; every other request carries an id that increases per request within
   * the run.
   */
  private buildJsonrpcRequest(jsonrpc: JsonrpcBody | undefined, headers: Record<string, string>): string {
    const method = this.substituteVariables(jsonrpc?.method ?? "")
    if (method.trim() === "") {
      throw new Error("JSON-RPC method is required")
    }
    const paramsText = this.substituteVariables(jsonrpc?.params ?? "", { json: true })
    let params: unknown
    if (paramsText.trim() !== "") {
      try {
        params = JSON.parse(paramsText)
      } catch {
        throw new Error("JSON-RPC params are not valid JSON")
      }
      if (params === null || typeof params !== "object") {
        throw new Error("JSON-RPC params must be a JSON object or array")
      }
    }
    const id = jsonrpc?.notification === true ? undefined : ++this.rpcId
    if (!Object.keys(headers).some((name) => name.toLowerCase() === "content-type")) {
      headers["Content-Type"] = "application/json"
    }
    return JSON.stringify({
      jsonrpc: "2.0",
      method,
      ...(params === undefined ? {} : { params }),
      ...(id === undefined ? {} : { id }),
    })
  }

  /** Resolve a file upload's bytes per its `type` — base64-decoded, read from disk, or a resolved variable. */
  private async readFileUploadContent(upload: { readonly type: string; readonly value: string }): Promise<Buffer> {
    switch (upload.type) {
      case "base64":
        return Buffer.from(upload.value, "base64")
      case "path":
        // ponytail: desktop single-user trust model — the path comes from the
        // user's own saved workflow config, the same trust boundary safe_http.ts
        // documents for outbound requests.
        return fs.readFile(upload.value)
      case "variable":
      default:
        return Buffer.from(this.substituteVariables(upload.value ?? ""), "utf-8")
    }
  }

  // -------------------- Status tracking --------------------

  private updateNodeStatus(nodeId: string, status: RunnerNodeStatus, result?: NodeResult): void {
    const error = typeof result?.error === "string" ? result.error : undefined
    const message = typeof result?.message === "string" ? result.message : undefined
    const statusCode = typeof result?.statusCode === "number" ? result.statusCode : undefined

    this.nodeStatuses.set(nodeId, status)
    if (this.deps.emitProgress) {
      this.deps.emitProgress({
        kind: "node.status",
        runId: this.activeRunId,
        nodeId,
        status,
        variables: { ...this.workflowVariables },
        ...(status === "failed" && error ? { error } : {}),
        ...(status === "failed" && message ? { message } : {}),
        ...(status === "failed" && statusCode !== undefined ? { statusCode } : {}),
      })
      if (result !== undefined) {
        this.deps.emitProgress({
          kind: "node.result",
          runId: this.activeRunId,
          nodeId,
          result: buildRunResult(nodeId, status, result),
        })
      }
    }
  }

  // -------------------- Output building --------------------

  private buildOutput(
    caseName: string | undefined,
    startedAt: string,
    seed: string | undefined,
    status: "passed" | "failed",
  ): ExecutorOutput {
    const result: ExecutorOutput = {
      status: this.cancelSignal?.aborted ? "cancelled" : status,
      startedAt,
      nodeStatuses: Object.fromEntries(this.nodeStatuses),
      extractedVariables: { ...this.workflowVariables },
      outputs: this.buildOutputs(),
      results: this.buildRunResults(),
      failedNodes: [...this.failedNodes],
      failureMessage: this.firstErrorMessage,
    }
    if (caseName !== undefined && seed !== undefined) {
      return { ...result, caseName, seed }
    }
    if (caseName !== undefined) {
      return { ...result, caseName }
    }
    if (seed !== undefined) {
      return { ...result, seed }
    }
    return result
  }

  private buildRunResults(): RunResult[] {
    const results: RunResult[] = []
    for (const [nodeId, result] of this.results.entries()) {
      if (this.seededNodeIds.has(nodeId)) continue
      const status = this.nodeStatuses.get(nodeId) ?? (result.status === "success" ? "passed" : "failed")
      results.push(buildRunResult(nodeId, status, result))
    }
    return results
  }

  private buildOutputs(): Record<string, unknown> {
    const outputs: Record<string, unknown> = {}
    for (const [nodeId, result] of this.results.entries()) {
      if (this.seededNodeIds.has(nodeId)) continue
      if (isResponseNodeType(result.type)) {
        outputs[nodeId] = { status: result.statusCode, body: result.body }
      } else if (result.type === "assertion") {
        outputs[nodeId] = { passed: result.assertionOutcome === "pass", message: result.message }
      } else if (result.type === "merge") {
        const branchResults = this.branchResults.get(nodeId)
        if (branchResults) {
          outputs[nodeId] = { branches: branchResults.map(([id]) => id), status: "joined" }
        }
      }
    }
    return outputs
  }
}

/** A node result rebuilt from its stored copy, for a rerun to read as it read the original. */
function seededNodeResult(stored: RunResult, type: WorkflowNode["type"]): NodeResult {
  const response = isJsonRecord(stored.response) ? stored.response : {}
  const request = isJsonRecord(stored.request) ? stored.request : {}
  const passed = stored.status === "passed"
  const statusCode = typeof response["statusCode"] === "number" ? response["statusCode"] : undefined
  return {
    status: passed ? "success" : "error",
    type,
    duration: stored.duration,
    ...(statusCode !== undefined
      ? {
          statusCode,
          headers: (isJsonRecord(response["headers"]) ? response["headers"] : {}) as Record<string, string>,
          body: response["body"],
          response: response as unknown as NonNullable<NodeResult["response"]>,
        }
      : {}),
    ...(typeof request["method"] === "string" ? { method: request["method"] } : {}),
    ...(typeof request["url"] === "string" ? { url: request["url"] } : {}),
    ...(typeof stored.error === "string" ? { error: stored.error } : {}),
    ...(type === "assertion"
      ? { assertionOutcome: passed ? "pass" as const : "fail" as const, assertionEvaluations: stored.assertions ?? [] }
      : {}),
  }
}

function isJsonRecord(value: JsonValue | null | undefined): value is { readonly [key: string]: JsonValue } {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toJsonValue(value: unknown): JsonValue {
  if (value === undefined) return null
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

/** RunResult.request: only the fields that are actually present on the node result. */
function buildRunResultRequest(result: NodeResult): { method?: string; url?: string } {
  return {
    ...(typeof result["method"] === "string" ? { method: result["method"] } : {}),
    ...(typeof result["url"] === "string" ? { url: result["url"] } : {}),
  }
}

/** RunResult.response: the raw response if captured, else a synthesized one from the loose statusCode/headers/body fields. */
function buildRunResultResponse(result: NodeResult): JsonValue {
  return toJsonValue(result.response ?? {
    ...(result.statusCode !== undefined ? { statusCode: result.statusCode } : {}),
    ...(result.headers !== undefined ? { headers: result.headers } : {}),
    ...(result.body !== undefined ? { body: result.body } : {}),
  })
}

type RunResultDiagnostics = Partial<
  Pick<RunResult, "secretRefs" | "unresolvedPlaceholders" | "extractorOutcomes" | "subWorkflow" | "scripts">
>

function copySubWorkflow(sub: NonNullable<NodeResult["subWorkflow"]>): NonNullable<RunResult["subWorkflow"]> {
  const { forEach, ...rest } = sub
  return {
    ...rest,
    outputVariableNames: [...sub.outputVariableNames],
    ...(forEach ? { forEach: { ...forEach, iterations: forEach.iterations.map((iteration) => ({ ...iteration })) } } : {}),
  }
}

function buildRunResultDiagnostics(result: NodeResult): RunResultDiagnostics {
  return {
    ...(result.secretRefs && result.secretRefs.length > 0 ? { secretRefs: [...result.secretRefs] } : {}),
    ...(result.unresolvedPlaceholders && result.unresolvedPlaceholders.length > 0
      ? { unresolvedPlaceholders: [...result.unresolvedPlaceholders] }
      : {}),
    ...(result.extractorOutcomes ? { extractorOutcomes: [...result.extractorOutcomes] } : {}),
    ...(result.scripts
      ? { scripts: result.scripts.map((script) => ({ ...script, logs: [...script.logs], tests: script.tests.map((test) => ({ ...test })) })) }
      : {}),
    ...(result.subWorkflow ? { subWorkflow: copySubWorkflow(result.subWorkflow) } : {}),
  }
}

function buildRunResult(nodeId: string, status: RunResult["status"], result: NodeResult): RunResult {
  return {
    nodeId,
    status,
    duration: Math.max(0, Math.round(typeof result.duration === "number" ? result.duration : 0)),
    ...(typeof result.startedAt === "string" ? { startedAt: result.startedAt } : {}),
    ...(typeof result.completedAt === "string" ? { completedAt: result.completedAt } : {}),
    // Echoed back so a matched negative test (e.g. a green 409) is legible in the run snapshot.
    ...(result.expectedStatus !== undefined
      ? { expectedStatus: (Array.isArray(result.expectedStatus) ? [...result.expectedStatus] : result.expectedStatus) as number | number[] }
      : {}),
    ...buildRunResultDiagnostics(result),
    ...(result.attempts ? { attempts: result.attempts.map((attempt) => ({ ...attempt })) } : {}),
    request: buildRunResultRequest(result),
    response: buildRunResultResponse(result),
    error: typeof result.error === "string" ? result.error : null,
    // An http-request node has them only when it checked `responseSchemas`.
    assertions: result.type === "assertion" || result.assertionEvaluations ? [...(result.assertionEvaluations ?? [])] : null,
  }
}

/** The `responseSchemas` key that applies to `status`: exact ("201"), then its class ("2XX"), then "default". */
export function responseSchemaKey(schemas: Readonly<Record<string, unknown>>, status: number): string | undefined {
  return [String(status), `${Math.floor(status / 100)}XX`, "default"].find((key) => schemas[key] !== undefined)
}

/**
 * The contract mode an HTTP node runs under: the run override (`--contract`)
 * wins, then the node's own `contract`, then `fail` when it carries OpenAPI
 * metadata and `off` otherwise.
 */
export function effectiveContract(config: Readonly<Record<string, unknown>> | undefined, override: ContractMode | undefined): ContractMode {
  if (override !== undefined) return override
  const configured = config?.["contract"]
  if (configured === "off" || configured === "warn" || configured === "fail") return configured
  return config?.["openapiMeta"] !== undefined ? "fail" : "off"
}

function toAssertionSource(value: string | undefined): AssertionSource {
  switch (value) {
    case "variables":
    case "status":
    case "cookies":
    case "headers":
      return value
    case "prev":
    default:
      return "prev"
  }
}

function toAssertionOperator(value: string): AssertionOperator {
  switch (value) {
    case "notEquals":
    case "contains":
    case "notContains":
    case "gt":
    case "gte":
    case "lt":
    case "lte":
    case "count":
    case "exists":
    case "notExists":
    case "matches":
    case "notMatches":
    case "type":
    case "matchesSchema":
      return value
    case "equals":
    default:
      return "equals"
  }
}

/** The "type" operator: JSON's types, plus integer. A missing value has none. */
function valueHasType(actual: unknown, expected: unknown): boolean {
  if (!(ASSERTION_VALUE_TYPES as readonly unknown[]).includes(expected)) {
    throw new Error(`Unknown type ${JSON.stringify(expected)}; use one of ${ASSERTION_VALUE_TYPES.join(", ")}`)
  }
  if (actual === undefined) return false
  if (expected === "integer") return Number.isInteger(actual)
  return jsonValueType(actual) === expected
}

function jsonValueType(value: unknown): JsonValueType | null {
  if (value === undefined) return null
  if (value === null) return "null"
  if (Array.isArray(value)) return "array"
  switch (typeof value) {
    case "object": return "object"
    case "boolean": return "boolean"
    case "number": return "number"
    case "string": return "string"
    default: return null
  }
}

/**
 * Why a script fails its node: the error that stopped it, or its failed
 * `aw.test`s. The prefix is what the scheduler's error classing lets through.
 */
function scriptFailure(outcome: ScriptOutcome): string | undefined {
  const label = outcome.phase === "preRequest" ? "Pre-request script" : "Post-response script"
  if (outcome.error !== undefined) return `${label} failed: ${outcome.error}`
  const failed = outcome.tests.filter((test) => !test.passed).length
  return failed > 0 ? `${label}: ${failed} of ${outcome.tests.length} tests failed` : undefined
}

/** Collect every {{secrets.NAME}} (and script `aw.secrets.get("NAME")`) referenced by a node's config (names only). */
function collectSecretRefs(config: Record<string, unknown> | undefined): readonly string[] {
  if (!config) return []
  const names = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      for (const name of extractSecretRefsFromString(value)) names.add(name)
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value !== null && typeof value === "object") {
      for (const item of Object.values(value as Record<string, unknown>)) visit(item)
    }
  }
  visit(config)
  return [...names]
}

/**
 * Reference-shaped placeholders (`{{env.*}}`, `{{variables.*}}`, `{{data.*}}`,
 * `{{prev...}}`, `{{secrets.*}}`) still present in a built HTTP request. `substituteVariables`
 * leaves an unresolved placeholder verbatim, so the assembled URL/headers/query
 * values tell us which references never resolved. Names only (never values).
 */
const UNRESOLVED_REF_RE = /\{\{\s*(env\.|variables\.|data\.|prev\b|secrets\.)([^}]*)\}\}/g

function collectUnresolvedPlaceholders(values: readonly string[]): string[] {
  const found = new Set<string>()
  for (const value of values) {
    for (const match of value.matchAll(UNRESOLVED_REF_RE)) {
      const prefix = match[1]!
      // `env./variables./data./secrets.` swallow their dot into the prefix, so `rest` never
      // starts with one — but `prev` (bare word-boundary, no dot) needs its `.` kept as
      // the join separator. Trimming (not stripping a leading dot) also drops the
      // trailing whitespace `{{ env.EMAIL }}` leaves in `rest` before the closing `}}`.
      const rest = (match[2] ?? "").trim()
      found.add(rest.length > 0 ? `${prefix}${rest}` : prefix)
    }
  }
  return [...found]
}
