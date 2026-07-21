import type { ContractErrorCode } from "@shared/contract/errors"

/**
 * Base for errors that map to a client-facing contract code. Handlers (Task 13)
 * throw these; the router converts them to `{ ok: false, error }` envelopes.
 * Anything that is NOT an `AppError` (or a zod `ZodError`) is an internal bug and
 * is re-thrown by the router — the IPC equivalent of an HTTP 500.
 */
export class AppError extends Error {
  readonly code: ContractErrorCode
  readonly details: unknown

  constructor(code: ContractErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = new.target.name
    this.code = code
    this.details = details
  }
}

/** Existence-hiding 404 — preserves `scope_resolver`'s not_found semantics. */
export class NotFoundError extends AppError {
  constructor(message: string, details?: unknown) {
    super("not_found", message, details)
  }
}

/** Was HTTP 422 — a request that fails business validation past the zod boundary. */
export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("validation", message, details)
  }
}

/** Was HTTP 409 — a request that conflicts with current state. */
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super("conflict", message, details)
  }
}

/** Was HTTP 403 — rare in single-user, kept for the future cloud/teams seam. */
export class DeniedError extends AppError {
  constructor(message: string, details?: unknown) {
    super("denied", message, details)
  }
}
