import { ZodError, type z } from "zod"
import type { ContractResult } from "@shared/contract/errors"
import type { JsonValue } from "@shared/types/JsonValue"
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
      return {
        ok: false,
        error: { code: "not_found", message: `no IPC handler: ${key(request.domain, request.action)}` },
      }
    }

    if (opts?.redactSecrets === true) {
      const placeholders = findRedactedPlaceholders(request.payload as JsonValue)
      if (placeholders.length > 0) {
        return {
          ok: false,
          error: {
            code: "validation",
            message:
              `refusing to store the redacted placeholder "${SECRET_PLACEHOLDER}" at ${placeholders.join(", ")}. `
              + "This value came from a redacted read, which withholds credential values. "
              + "Send the real value, or a {{secrets.NAME}} reference, or omit the field to leave it unchanged.",
            details: { paths: placeholders },
          },
        }
      }
    }

    const parsed = handler.input.safeParse(request.payload)
    if (!parsed.success) {
      return {
        ok: false,
        error: { code: "validation", message: "request validation failed", details: parsed.error.issues },
      }
    }

    let output: unknown
    try {
      output = await handler.handle(parsed.data)
    } catch (error) {
      return toErrorEnvelope(error)
    }

    // Output is validated OUTSIDE the try: a bad handler return is a server bug,
    // so its zod failure must throw (HTTP-500 equivalent), not read as a client
    // `validation` error.
    const validated = handler.output.parse(output)
    return {
      ok: true,
      data: opts?.redactSecrets === true ? sanitizeAgentReadValue(validated as JsonValue) : validated,
    }
  }
}
