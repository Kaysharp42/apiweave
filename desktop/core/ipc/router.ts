import { ZodError, type z } from "zod"
import type { ContractResult } from "../../../shared/contract/errors"
import { AppError } from "./errors"

/** The untrusted envelope every renderer call sends over the single channel. */
export type InvokeRequest = {
  readonly domain: string
  readonly action: string
  readonly payload: unknown
}

export type HandlerRegistration<I extends z.ZodType, O extends z.ZodType> = {
  readonly input: I
  readonly output: O
  readonly handle: (input: z.infer<I>) => Promise<z.infer<O>> | z.infer<O>
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

  async dispatch(request: InvokeRequest): Promise<ContractResult<unknown>> {
    const handler = this.handlers.get(key(request.domain, request.action))
    if (handler === undefined) {
      return {
        ok: false,
        error: { code: "not_found", message: `no IPC handler: ${key(request.domain, request.action)}` },
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
    return { ok: true, data: handler.output.parse(output) }
  }
}
