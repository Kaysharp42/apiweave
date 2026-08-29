import { ZodError, type z } from "zod"
import type { ContractErrorCode, ContractResult } from "@shared/contract/errors"
import type { JsonValue } from "@shared/types/JsonValue"
import type { AgentWriteEvent } from "@shared/types/AgentWriteEvent"
import { AppError } from "./errors"
import { findRedactedPlaceholders, sanitizeAgentReadValue, SECRET_PLACEHOLDER } from "../services/secret_utils"

/** The untrusted envelope every renderer call sends over the single channel. */
export type InvokeRequest = {
  readonly domain: string
  readonly action: string
  readonly payload: unknown
}

/**
 * Bridge the zod-inferred handler types to the service-layer domain types under
 * `exactOptionalPropertyTypes` + readonly aggregates. Runtime behaviour is
 * unchanged (dispatch still zod-validates both ends); these only widen what the
 * handler author may pass/return so the two type worlds meet without per-call casts.
 *
 * - {@link CleanInput}: zod `.optional()` infers `p?: T | undefined`, but a service
 *   param (`Partial<Pick<…>>`) rejects an *explicit* `undefined`. Drop it.
 * - {@link ReadonlyResult}: services return readonly arrays/aggregates; zod infers
 *   mutable ones. A readonly value is a fine return — widen the target to accept it.
 */
type CleanInput<T> = T extends readonly unknown[] | Uint8Array
  ? T
  : T extends object
    ? { [K in keyof T]: CleanInput<Exclude<T[K], undefined>> }
    : T

type ReadonlyResult<T> = T extends (infer U)[]
  ? readonly ReadonlyResult<U>[]
  : T extends object
    ? { readonly [K in keyof T]: ReadonlyResult<T[K]> }
    : T

export type HandlerRegistration<I extends z.ZodType, O extends z.ZodType> = {
  readonly input: I
  readonly output: O
  readonly handle: (input: CleanInput<z.infer<I>>) => Promise<ReadonlyResult<z.infer<O>>> | ReadonlyResult<z.infer<O>>
}

/** A registered handler, read-only. Lets a second transport (MCP) reuse the same input schema + handler. */
export type RegisteredHandler = HandlerRegistration<z.ZodType, z.ZodType>

/** A rejected dispatch, ready for a log line. `code` is one of the contract
 * codes, or "internal" for a handler failure that will be re-thrown (the IPC
 * equivalent of an HTTP 500 — a bug, not a client mistake). */
export type IpcErrorReport = {
  readonly domain: string
  readonly action: string
  readonly code: ContractErrorCode | "internal"
  readonly message: string
  readonly details?: unknown
}

export interface IpcRouterOptions {
  /**
   * Observes every rejected dispatch — unregistered actions, request
   * validation failures, `AppError`s, and internal handler failures alike.
   * The composition root wires this to electron-log's file transport so a
   * refused save leaves a line in `logs/main.log` that names the cause,
   * rather than dying silently in a toast. Never invoked for `ok` results.
   */
  readonly reportError?: (report: IpcErrorReport) => void

  /**
   * Observes every successful MCP write, so the renderer can refetch what an
   * agent changed. Wired by the composition root to the `apiweave:agent-write`
   * broadcast; see that channel for why the renderer cannot otherwise hear
   * about a write to any repository but `WorkflowRepository`.
   *
   * Fanned out from here rather than handed to the MCP bridge because the
   * router is already the seam both transports share, and `reportError` above
   * already establishes the shape. `dispatch` never calls it — the bridge does,
   * via {@link IpcRouter.notifyAgentWrite}, because only the MCP tool whitelist
   * knows which actions are writes.
   */
  readonly onAgentWrite?: (event: AgentWriteEvent) => void
}

type StoredHandler = RegisteredHandler

function key(domain: string, action: string): string {
  return `${domain}.${action}`
}

/**
 * Maps a caught handler error to a contract envelope. Known `AppError`s carry
 * their code; a zod failure is a `validation`; anything else is an internal bug
 * and is re-thrown so it surfaces as a rejected renderer promise (HTTP-500
 * equivalent) rather than being mislabelled as one of the four client codes.
 * ponytail: the four codes are the whole contract — no `internal` code is added.
 */
function toErrorEnvelope(error: unknown): ContractResult<never> {
  if (error instanceof AppError) {
    return { ok: false, error: { code: error.code, message: error.message, details: error.details } }
  }
  if (error instanceof ZodError) {
    return {
      ok: false,
      error: { code: "validation", message: "response validation failed", details: error.issues },
    }
  }
  throw error
}

/**
 * The IPC dispatch core, deliberately free of any `electron` import so it is unit
 * testable. `register.ts` bolts it onto `ipcMain.handle`; `dispatch` is the seam
 * the tests drive directly.
 */
export class IpcRouter {
  private readonly handlers = new Map<string, StoredHandler>()
  private readonly reportError: ((report: IpcErrorReport) => void) | undefined
  private readonly onAgentWrite: ((event: AgentWriteEvent) => void) | undefined

  constructor(options: IpcRouterOptions = {}) {
    this.reportError = options.reportError
    this.onAgentWrite = options.onAgentWrite
  }

  /** Announce a successful MCP write. Called by `mcp/bridge.ts`; see
   * {@link IpcRouterOptions.onAgentWrite}. */
  notifyAgentWrite(event: AgentWriteEvent): void {
    this.onAgentWrite?.(event)
  }

  register<I extends z.ZodType, O extends z.ZodType>(
    domain: string,
    action: string,
    registration: HandlerRegistration<I, O>,
  ): void {
    const id = key(domain, action)
    if (this.handlers.has(id)) {
      throw new Error(`duplicate IPC handler: ${id}`)
    }
    this.handlers.set(id, registration as unknown as StoredHandler)
  }

  /** Registered `{domain}.{action}` keys — used by the route-reconciliation test. */
  keys(): readonly string[] {
    return [...this.handlers.keys()]
  }

  /** The registration for a `{domain}.{action}`, or undefined. The MCP bridge reads
   * the input schema from here; execution still goes through {@link dispatch} so the
   * validate → handle → validate path is shared, not forked. */
  getRegistration(domain: string, action: string): RegisteredHandler | undefined {
    return this.handlers.get(key(domain, action))
  }

  /**
   * `redactSecrets` is set by the MCP transport (see `mcp/bridge.ts`): any local
   * MCP client is a less-trusted caller than the app's own renderer, so its reads
   * get a second secret-redaction pass over the full response — headers, cookies,
   * auth config, URLs, bodies — on top of whatever a given handler already does.
   * Renderer IPC calls (`ipc/register.ts`) never set this, since the renderer
   * needs literal values to render its own editors.
   *
   * The pass is structure-preserving (`sanitizeAgentReadValue`): values are
   * withheld, keys and array entries are not, so an agent can read back what it
   * wrote and see it. Export bundles use the stricter drop-and-flatten mode.
   *
   * The flag is symmetric: a caller whose reads are redacted also has its writes
   * checked for the `<SECRET>` placeholder those reads produce, so a
   * read-modify-write round trip fails loudly instead of persisting a
   * placeholder that the next run would send upstream as the credential. The
   * check belongs here rather than in the services because only a redacted
   * caller can fall into it — the renderer reads literal values, and an imported
   * bundle legitimately carries `<SECRET>` that the operator refills in the UI.
   */
  async dispatch(request: InvokeRequest, opts?: { readonly redactSecrets?: boolean }): Promise<ContractResult<unknown>> {
    const handler = this.handlers.get(key(request.domain, request.action))
    if (handler === undefined) {
      const message = `no IPC handler: ${key(request.domain, request.action)}`
      this.notifyError({ domain: request.domain, action: request.action, code: "not_found", message })
      return {
        ok: false,
        error: { code: "not_found", message },
      }
    }

    const redactionRejection = this.rejectRedactedPayload(request, opts)
    if (redactionRejection !== undefined) return redactionRejection

    const parsed = handler.input.safeParse(request.payload)
    if (!parsed.success) {
      this.notifyError({
        domain: request.domain,
        action: request.action,
        code: "validation",
        message: "request validation failed",
        details: parsed.error.issues,
      })
      return {
        ok: false,
        error: { code: "validation", message: "request validation failed", details: parsed.error.issues },
      }
    }

    let output: unknown
    try {
      output = await handler.handle(parsed.data)
    } catch (error) {
      this.notifyHandlerError(request, error)
      return toErrorEnvelope(error)
    }

    // Output is validated OUTSIDE the try: a bad handler return is a server bug,
    // so its zod failure must throw (HTTP-500 equivalent), not read as a client
    // `validation` error.
    const validated = this.parseOutput(handler, request, output)
    return this.buildSuccessEnvelope(validated, opts)
  }

  /** A caller whose reads are redacted also has its writes checked for the
   * `<SECRET>` placeholder: sending it back would persist the placeholder as
   * the literal credential. Returns the rejection envelope, or undefined when
   * the payload is clean (or the caller isn't a redacted one). */
  private rejectRedactedPayload(
    request: InvokeRequest,
    opts?: { readonly redactSecrets?: boolean },
  ): ContractResult<never> | undefined {
    if (opts?.redactSecrets !== true) return undefined
    const placeholders = findRedactedPlaceholders(request.payload as JsonValue)
    if (placeholders.length === 0) return undefined
    const message =
      `refusing to store the redacted placeholder "${SECRET_PLACEHOLDER}" at ${placeholders.join(", ")}. `
      + "This value came from a redacted read, which withholds credential values. "
      + "Send the real value, or a {{secrets.NAME}} reference, or omit the field to leave it unchanged."
    this.notifyError({
      domain: request.domain,
      action: request.action,
      code: "validation",
      message,
      details: { paths: placeholders },
    })
    return {
      ok: false,
      error: { code: "validation", message, details: { paths: placeholders } },
    }
  }

  /** Validates a handler's return value against its own output schema. A
   * mismatch is a server bug (HTTP-500 equivalent): logged, then re-thrown. */
  private parseOutput(handler: StoredHandler, request: InvokeRequest, output: unknown): unknown {
    try {
      return handler.output.parse(output)
    } catch (error) {
      this.notifyError({
        domain: request.domain,
        action: request.action,
        code: "internal",
        message: "response validation failed",
        details: error instanceof ZodError ? error.issues : undefined,
      })
      throw error
    }
  }

  private buildSuccessEnvelope(validated: unknown, opts?: { readonly redactSecrets?: boolean }): ContractResult<unknown> {
    return {
      ok: true,
      data: opts?.redactSecrets === true ? sanitizeAgentReadValue(validated as JsonValue) : validated,
    }
  }

  /** Feed a rejected dispatch to the observer. A throwing logger must never
   * break the IPC contract, so its own failures are swallowed. */
  private notifyError(report: IpcErrorReport): void {
    try {
      this.reportError?.(report)
    } catch {
      // Logging is best-effort; the envelope still reaches the caller.
    }
  }

  private notifyHandlerError(request: InvokeRequest, error: unknown): void {
    if (error instanceof AppError) {
      this.notifyError({
        domain: request.domain,
        action: request.action,
        code: error.code,
        message: error.message,
        details: error.details,
      })
      return
    }
    if (error instanceof ZodError) {
      this.notifyError({
        domain: request.domain,
        action: request.action,
        code: "validation",
        message: "response validation failed",
        details: error.issues,
      })
      return
    }
    // Anything else is an internal bug and is re-thrown by toErrorEnvelope —
    // the IPC equivalent of an HTTP 500. Still worth the log line.
    this.notifyError({
      domain: request.domain,
      action: request.action,
      code: "internal",
      message: error instanceof Error ? error.message : String(error),
    })
  }
}
