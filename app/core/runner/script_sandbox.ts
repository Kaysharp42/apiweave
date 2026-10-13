import { createHash, createHmac } from "node:crypto"
import path from "node:path"
import { Worker } from "node:worker_threads"
import {
  newQuickJSWASMModuleFromVariant,
  newVariant,
  shouldInterruptAfterDeadline,
  type QuickJSContext,
  type QuickJSHandle,
  type QuickJSWASMModule,
} from "quickjs-emscripten-core"
import variant from "@jitl/quickjs-singlefile-cjs-release-sync"
import type { ScriptOutcome } from "@shared/types/ScriptOutcome"
import type { ScriptTestResult } from "@shared/types/ScriptTestResult"

/**
 * The sandbox an http-request node's scripts run in: QuickJS compiled to
 * WebAssembly, a separate JavaScript engine with its own heap. Nothing of the
 * host is reachable from inside — no `require`, `process`, network, file
 * system or timers — except the one dispatcher below, which serves the `aw`
 * API (variables, crypto, console, tests) with strings in and strings out.
 *
 * Every script gets a fresh WebAssembly instance whose linear memory is
 * capped, so a script that allocates without end fails with "out of memory"
 * inside the sandbox instead of growing the app's heap; the instance is
 * dropped afterwards, so nothing one script leaves behind is seen by the
 * next. QuickJS's own malloc accounting cannot measure allocations in this
 * build (no malloc_usable_size), which is why the cap is on the memory itself.
 *
 * A script is synchronous, so `runScript` evaluates it on a worker thread
 * (`script_worker.ts`) rather than the caller's: in the app the caller
 * is Electron's main process, which a `while (true) {}` would otherwise freeze
 * — IPC, the MCP bridge and the Cancel button with it — until the deadline.
 * The interrupt handler stops the script at its deadline inside the worker;
 * cancelling the run terminates the worker. The WASM variant has the binary
 * embedded in its JavaScript, so esbuild bundles it into the worker with no
 * .wasm file to locate.
 */

export interface ScriptRequest {
  method: string
  url: string
  headers: Record<string, string>
  /** The text body; null when there is none or it is not text (form-data, a file). */
  body: string | null
}

export interface ScriptResponse {
  readonly status: number
  readonly headers: Readonly<Record<string, string>>
  /** Parsed JSON when the body was JSON, else its text. */
  readonly body: unknown
  readonly responseTime: number
}

export interface ScriptRun {
  readonly phase: ScriptOutcome["phase"]
  readonly source: string
  readonly timeoutMs: number
  /** The run's workflow variables. `aw.variables.set` writes into this object. */
  readonly variables: Record<string, unknown>
  readonly env: Readonly<Record<string, unknown>>
  readonly data: Readonly<Record<string, unknown>>
  /** Only the secrets the script names (see `scriptSecretNames`). */
  readonly secrets: Readonly<Record<string, string>>
  readonly request?: ScriptRequest
  readonly response?: ScriptResponse
  readonly uuid: () => string
}

export interface ScriptRunResult {
  readonly outcome: ScriptOutcome
  /** The request as the pre-request script left it; absent when the script failed. */
  readonly request?: ScriptRequest
}

const WASM_PAGE_BYTES = 64 * 1024
/** QuickJS's own static data and C stack: the module's declared initial memory (16 MiB). */
const BASE_PAGES = 256
export const SCRIPT_MEMORY_LIMIT_BYTES = 32 * 1024 * 1024
/**
 * QuickJS's own stack check. Deep recursion is caught here as "stack overflow";
 * a construct that recurses inside the parser can still exhaust the host's
 * stack first, which `runScript` reports the same way.
 */
export const MAX_STACK_BYTES = 256 * 1024
const MAX_LOG_LINES = 100
/** Longest console line, test name or error kept; the rest is cut so a large response body quoted by `aw.expect` cannot balloon run history and reports. */
const MAX_TEXT_LENGTH = 2000
const MAX_TESTS = 100
const MAX_VARIABLE_BYTES = 1024 * 1024

const FILE_NAMES: Record<ScriptOutcome["phase"], string> = {
  preRequest: "pre-request.js",
  postResponse: "post-response.js",
}

/** Builds `aw` and `console` inside the sandbox and returns the function that reads the request back. */
const PRELUDE = String.raw`(function (host, inputJson) {
  "use strict"
  const input = JSON.parse(inputJson)
  const show = (value) => {
    if (typeof value === "string") return value
    try {
      const json = JSON.stringify(value)
      return json === undefined ? String(value) : json
    } catch (error) {
      return String(value)
    }
  }
  const quote = (value) => typeof value === "string" ? JSON.stringify(value) : show(value)
  const log = (...args) => host("log", args.map(show).join(" "))
  globalThis.console = Object.freeze({ log, info: log, warn: log, error: log, debug: log })

  const reader = (values) => Object.freeze({ get: (name) => values[String(name)] })
  const variables = Object.freeze({
    get: (name) => input.variables[String(name)],
    set: (name, value) => {
      const json = JSON.stringify(value)
      if (json === undefined) throw new TypeError("aw.variables.set: the value must be JSON (a string, number, boolean, null, array or object)")
      host("set", String(name), json)
      input.variables[String(name)] = JSON.parse(json)
    },
  })

  class AssertionError extends Error {}
  AssertionError.prototype.name = "AssertionError"
  const deepEqual = (a, b) => {
    if (Object.is(a, b)) return true
    if (typeof a !== "object" || typeof b !== "object" || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false
    const keys = Object.keys(a)
    return keys.length === Object.keys(b).length && keys.every((key) => Object.prototype.hasOwnProperty.call(b, key) && deepEqual(a[key], b[key]))
  }
  const expect = (actual) => {
    const matchers = (negate) => {
      const matcher = (describe, test) => (...args) => {
        if (Boolean(test(...args)) === negate) {
          throw new AssertionError("expected " + quote(actual) + (negate ? " not " : " ") + describe(...args))
        }
      }
      return {
        toBe: matcher((expected) => "to be " + quote(expected), (expected) => Object.is(actual, expected)),
        toEqual: matcher((expected) => "to equal " + quote(expected), (expected) => deepEqual(actual, expected)),
        toContain: matcher(
          (item) => "to contain " + quote(item),
          (item) => typeof actual === "string" ? actual.includes(String(item)) : Array.isArray(actual) && actual.some((entry) => deepEqual(entry, item)),
        ),
        toMatch: matcher((pattern) => "to match " + String(pattern), (pattern) => typeof actual === "string" && (pattern instanceof RegExp ? pattern.test(actual) : actual.includes(String(pattern)))),
        toBeGreaterThan: matcher((n) => "to be greater than " + quote(n), (n) => actual > n),
        toBeLessThan: matcher((n) => "to be less than " + quote(n), (n) => actual < n),
        toBeTruthy: matcher(() => "to be truthy", () => actual),
        toBeDefined: matcher(() => "to be defined", () => actual !== undefined),
      }
    }
    return Object.freeze({ ...matchers(false), not: Object.freeze(matchers(true)) })
  }
  const test = (name, fn) => {
    try {
      const result = fn()
      if (result !== null && typeof result === "object" && typeof result.then === "function") {
        throw new Error("aw.test callbacks must be synchronous: scripts cannot await")
      }
      host("test", String(name), "")
    } catch (error) {
      host("test", String(name), error instanceof Error ? error.name + ": " + error.message : show(error))
    }
  }

  const response = input.response && Object.freeze({
    status: input.response.status,
    statusCode: input.response.status,
    headers: Object.freeze(input.response.headers),
    body: input.response.body,
    responseTime: input.response.responseTime,
    header: (name) => {
      const wanted = String(name).toLowerCase()
      const key = Object.keys(input.response.headers).find((candidate) => candidate.toLowerCase() === wanted)
      return key === undefined ? undefined : input.response.headers[key]
    },
    json: () => typeof input.response.body === "string" ? JSON.parse(input.response.body) : input.response.body,
    text: () => typeof input.response.body === "string" ? input.response.body : JSON.stringify(input.response.body),
  })

  globalThis.aw = Object.freeze({
    variables,
    env: reader(input.env),
    data: reader(input.data),
    secrets: reader(input.secrets),
    request: input.request,
    response,
    test,
    expect,
    crypto: Object.freeze({
      hmacSha256: (key, message, encoding = "hex", keyEncoding = "utf8") => host("hmacSha256", String(key), String(message), String(encoding), String(keyEncoding)),
      sha256: (message, encoding = "hex") => host("sha256", String(message), String(encoding)),
      base64Encode: (text) => host("base64Encode", String(text)),
      base64Decode: (text) => host("base64Decode", String(text)),
      uuid: () => host("uuid"),
    }),
  })
  return () => JSON.stringify(input.request === undefined ? null : input.request)
})`

const OUTPUT_ENCODINGS = new Set(["hex", "base64", "base64url"])
const KEY_ENCODINGS = new Set(["utf8", "hex", "base64"])

function encoding<T extends string>(value: string, allowed: ReadonlySet<string>, what: string): T {
  if (!allowed.has(value)) throw new TypeError(`${what} must be one of ${[...allowed].join(", ")}`)
  return value as T
}

/** A fresh QuickJS instance whose WebAssembly memory is capped at SCRIPT_MEMORY_LIMIT_BYTES above QuickJS's own. */
export function newSandboxModule(): Promise<QuickJSWASMModule> {
  const memory = new WebAssembly.Memory({
    initial: BASE_PAGES,
    maximum: BASE_PAGES + SCRIPT_MEMORY_LIMIT_BYTES / WASM_PAGE_BYTES,
  })
  return newQuickJSWASMModuleFromVariant(newVariant(variant, { wasmMemory: memory }))
}

/** One script for a worker; `uuid` is served over `channel` (see `script_worker.ts`). */
export interface ScriptJob {
  readonly run: Omit<ScriptRun, "uuid">
  readonly channel: SharedArrayBuffer
}

export type ScriptWorkerMessage =
  | { readonly type: "uuid" }
  | { readonly type: "done"; readonly result: ScriptRunResult; readonly assigned: Record<string, unknown> }

/** Room for one `uuid()` reply: an Int32 ready flag, an Int32 byte length, then the UTF-8 bytes. */
export const SCRIPT_CHANNEL_BYTES = 8 + 256

function spawnScriptWorker(): Worker {
  // From TypeScript source (vitest, tsx harnesses) the entry is loaded through tsx.
  if (__filename.endsWith(".ts")) {
    const entry = JSON.stringify(path.join(__dirname, "script_worker.ts"))
    return new Worker(`require("tsx/cjs"); require(${entry})`, { eval: true })
  }
  // Bundled, the worker sits beside main.cjs / apiweave.cjs. Packaged, it is
  // unpacked (build.asarUnpack) and loaded from app.asar.unpacked, as node-pty
  // loads its own worker: a worker's entry is read outside Electron's asar shim.
  return new Worker(path.join(__dirname, "script-worker.cjs").replace(`app.asar${path.sep}`, `app.asar.unpacked${path.sep}`))
}

/**
 * Workers that finished a script, kept for the next: starting one costs ~30 ms
 * (loading the bundled engine), ten times the script itself, and a data-driven
 * run pays that per row. Reuse carries nothing over — every script still gets a
 * fresh WebAssembly instance — and an idle worker is unref'd, so it never keeps
 * the CLI or the app from exiting.
 * ponytail: never trimmed; it holds as many workers as scripts ever ran at once,
 * which the scheduler's concurrency bounds. Add an idle timeout if that grows.
 */
const idleWorkers: Worker[] = []

function acquireWorker(): Worker {
  const idle = idleWorkers.pop()
  if (idle) {
    idle.ref()
    return idle
  }
  const worker = spawnScriptWorker()
  worker.on("exit", () => {
    const index = idleWorkers.indexOf(worker)
    if (index !== -1) idleWorkers.splice(index, 1)
  })
  return worker
}

/**
 * Run one script on a worker thread. Never throws: every failure, cancellation
 * included, is the outcome's `error`; cancelling terminates the worker, which
 * stops the script wherever it is. Variables the script set are written into
 * `run.variables` when it finishes.
 */
export function runScript(run: ScriptRun, signal?: AbortSignal): Promise<ScriptRunResult> {
  const started = Date.now()
  const failed = (error: string): ScriptRunResult => ({
    outcome: { phase: run.phase, duration: Date.now() - started, logs: [], tests: [], error },
  })
  if (signal?.aborted) return Promise.resolve(failed("Script cancelled"))
  const { uuid, ...data } = run
  const channel = new SharedArrayBuffer(SCRIPT_CHANNEL_BYTES)
  const worker = acquireWorker()
  return new Promise((resolve) => {
    const finish = (result: ScriptRunResult, reusable: boolean): void => {
      signal?.removeEventListener("abort", cancel)
      worker.off("message", onMessage).off("error", onError).off("exit", onExit)
      if (reusable) {
        worker.unref()
        idleWorkers.push(worker)
      } else {
        void worker.terminate()
      }
      resolve(result)
    }
    const cancel = (): void => finish(failed("Script cancelled"), false)
    const onError = (error: Error): void => finish(failed(`Script worker failed: ${error.message}`), false)
    const onExit = (): void => finish(failed("Script worker exited before the script finished"), false)
    const onMessage = (message: ScriptWorkerMessage): void => {
      if (message.type === "uuid") {
        const flags = new Int32Array(channel, 0, 2)
        flags[1] = Buffer.from(uuid()).copy(new Uint8Array(channel, 8))
        Atomics.store(flags, 0, 1)
        Atomics.notify(flags, 0)
        return
      }
      for (const [name, value] of Object.entries(message.assigned)) {
        // Defined rather than assigned, so a variable named `__proto__` is a variable.
        Object.defineProperty(run.variables, name, { value, writable: true, enumerable: true, configurable: true })
      }
      finish(message.result, true)
    }
    signal?.addEventListener("abort", cancel, { once: true })
    worker.on("message", onMessage).on("error", onError).on("exit", onExit)
    worker.postMessage({ run: data, channel } satisfies ScriptJob)
  })
}

/**
 * Evaluate one script on the calling thread — the worker's. Variables the
 * script sets are written into `assigned`, not `run.variables`, for
 * `runScript` to apply. Never throws: every failure is the outcome's `error`.
 */
export async function evaluateScript(run: ScriptRun, assigned: Record<string, unknown>): Promise<ScriptRunResult> {
  const fileName = FILE_NAMES[run.phase]
  const logs: string[] = []
  const tests: ScriptTestResult[] = []
  const started = Date.now()
  const outcome = (error?: string): ScriptOutcome => ({
    phase: run.phase,
    duration: Date.now() - started,
    logs,
    tests,
    ...(error === undefined ? {} : { error: clip(error) }),
  })

  const quickjs = await newSandboxModule()
  const runtime = quickjs.newRuntime()
  runtime.setMaxStackSize(MAX_STACK_BYTES)
  runtime.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + run.timeoutMs))
  const context = runtime.newContext()

  const host = (op: string, args: readonly string[]): string | undefined => {
    switch (op) {
      case "log":
        recordLog(logs, args[0] ?? "")
        return undefined
      case "test":
        recordTest(tests, args)
        return undefined
      case "set":
        assignVariable(assigned, args)
        return undefined
      case "uuid":
        return run.uuid()
      default:
        return compute(op, args)
    }
  }

  // ponytail: nothing is disposed — the whole WebAssembly instance is dropped
  // after the run, which frees everything at once, including what a script
  // that hit a limit left half-built.
  try {
    const hostFn = context.newFunction("host", (...handles) => {
      const [op, ...args] = handles.map((handle) => context.getString(handle))
      const value = host(op ?? "", args)
      return value === undefined ? undefined : context.newString(value)
    })
    const input = JSON.stringify({
      variables: run.variables,
      env: run.env,
      data: run.data,
      secrets: run.secrets,
      request: run.request,
      response: run.response,
    })
    const prelude = unwrap(context, context.evalCode(PRELUDE, "aw-prelude.js"))
    const readRequest = unwrap(context, context.callFunction(prelude, context.undefined, hostFn, context.newString(input)))

    const result = context.evalCode(run.source, fileName)
    if (result.error) return { outcome: outcome(describeError(context.dump(result.error), fileName, run.timeoutMs)) }
    if (tests.some((test) => !test.passed) || run.phase === "postResponse") return { outcome: outcome() }

    const read = context.callFunction(readRequest, context.undefined)
    if (read.error) return { outcome: outcome(describeError(context.dump(read.error), fileName, run.timeoutMs)) }
    const request = parseRequest(context.getString(read.value))
    return typeof request === "string" ? { outcome: outcome(request) } : { outcome: outcome(), request }
  } catch (error) {
    // The host's own stack ran out inside QuickJS (a construct it recursed on
    // without its own check): the instance is in an unknown state, and dropped.
    if (error instanceof RangeError) return { outcome: outcome("InternalError: stack overflow") }
    return { outcome: outcome(error instanceof Error ? error.message : String(error)) }
  }
}

function recordLog(logs: string[], line: string): void {
  if (logs.length < MAX_LOG_LINES) {
    logs.push(clip(line))
  } else if (logs.length === MAX_LOG_LINES) {
    logs.push(`… output after ${MAX_LOG_LINES} lines dropped`)
  }
}

function recordTest(tests: ScriptTestResult[], args: readonly string[]): void {
  if (tests.length >= MAX_TESTS) throw new RangeError(`a script may record at most ${MAX_TESTS} tests`)
  tests.push(args[1] ? { name: clip(args[0] ?? ""), passed: false, error: clip(args[1]) } : { name: clip(args[0] ?? ""), passed: true })
}

function assignVariable(assigned: Record<string, unknown>, args: readonly string[]): void {
  const json = args[1] ?? "null"
  if (json.length > MAX_VARIABLE_BYTES) throw new RangeError(`aw.variables.set: a value may be at most ${MAX_VARIABLE_BYTES} bytes of JSON`)
  // Defined rather than assigned, so a variable named `__proto__` is a variable.
  Object.defineProperty(assigned, args[0] ?? "", {
    value: JSON.parse(json) as unknown,
    writable: true,
    enumerable: true,
    configurable: true,
  })
}

/** The host operations that only compute: hashing and base64. */
function compute(op: string, args: readonly string[]): string {
  switch (op) {
    case "hmacSha256": {
      const [key = "", message = "", output = "", keyEncoding = ""] = args
      return createHmac("sha256", Buffer.from(key, encoding<BufferEncoding>(keyEncoding, KEY_ENCODINGS, "aw.crypto.hmacSha256 keyEncoding")))
        .update(message, "utf8")
        .digest(encoding<"hex" | "base64" | "base64url">(output, OUTPUT_ENCODINGS, "aw.crypto.hmacSha256 encoding"))
    }
    case "sha256":
      return createHash("sha256")
        .update(args[0] ?? "", "utf8")
        .digest(encoding<"hex" | "base64" | "base64url">(args[1] ?? "", OUTPUT_ENCODINGS, "aw.crypto.sha256 encoding"))
    case "base64Encode":
      return Buffer.from(args[0] ?? "", "utf8").toString("base64")
    case "base64Decode":
      return Buffer.from(args[0] ?? "", "base64").toString("utf8")
    default:
      throw new TypeError(`unknown operation ${op}`)
  }
}

function clip(text: string): string {
  return text.length > MAX_TEXT_LENGTH ? `${text.slice(0, MAX_TEXT_LENGTH)}…` : text
}

function unwrap(context: QuickJSContext, result: ReturnType<QuickJSContext["evalCode"]>): QuickJSHandle {
  if (result.error) throw new Error(`script sandbox failed to start: ${JSON.stringify(context.dump(result.error))}`)
  return result.value
}

/** `Name: message (line L, column C)` for an error the script threw, located in the script's own file. */
function describeError(error: unknown, fileName: string, timeoutMs: number): string {
  if (typeof error !== "object" || error === null) return `Uncaught ${JSON.stringify(error) ?? String(error)}`
  const fields = error as Record<string, unknown>
  const name = typeof fields["name"] === "string" ? fields["name"] : "Error"
  const message = typeof fields["message"] === "string" ? fields["message"] : JSON.stringify(error)
  if (name === "InternalError" && message === "interrupted") return `Script timed out after ${timeoutMs} ms`
  if (name === "InternalError" && message === "out of memory") {
    return `Script ran out of memory (limit ${SCRIPT_MEMORY_LIMIT_BYTES / 1024 / 1024} MB)`
  }
  const stack = typeof fields["stack"] === "string" ? fields["stack"] : ""
  const at = new RegExp(`${fileName.replace(".", "\\.")}:(\\d+):(\\d+)`).exec(stack)
  return at ? `${name}: ${message} (line ${at[1]}, column ${at[2]})` : `${name}: ${message}`
}

/** The request the pre-request script left, checked field by field; a string is what is wrong with it. */
function parseRequest(json: string): ScriptRequest | string {
  const value = JSON.parse(json) as unknown
  if (typeof value !== "object" || value === null) return "aw.request must stay an object"
  const fields = value as Record<string, unknown>
  const { method, url, headers, body } = fields
  if (typeof method !== "string" || method === "") return "aw.request.method must be a non-empty string"
  if (typeof url !== "string" || url === "") return "aw.request.url must be a non-empty string"
  if (typeof headers !== "object" || headers === null || Array.isArray(headers)) return "aw.request.headers must be an object"
  const headerRecord: Record<string, string> = {}
  for (const [name, headerValue] of Object.entries(headers)) {
    if (typeof headerValue !== "string") return `aw.request.headers[${JSON.stringify(name)}] must be a string`
    headerRecord[name] = headerValue
  }
  if (body !== null && body !== undefined && typeof body !== "string") return "aw.request.body must be a string or null"
  return { method: method.toUpperCase(), url, headers: headerRecord, body: typeof body === "string" ? body : null }
}
