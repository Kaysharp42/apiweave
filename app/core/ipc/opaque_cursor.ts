import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"
import { ConflictError, ValidationError } from "./errors"

// Process-local signing makes cursors tamper-proof and deliberately opaque to
// callers. A restart invalidates an outstanding cursor; clients can safely make
// a fresh bounded read in that case.
const cursorKey = randomBytes(32)

/** HMAC bytes kept per cursor: enough to make forging infeasible, short enough to cost ~22 characters. */
const SIGNATURE_BYTES = 16

/** Short digest of the request a cursor must accompany (workspace, workflow, filters). */
export function cursorScope(request: unknown): string {
  return createHash("sha256").update(JSON.stringify(request)).digest().subarray(0, 8).toString("base64url")
}

export interface OpenedCursor {
  readonly scope: string
  readonly snapshot: string
  readonly position: readonly string[]
}

/**
 * A cursor is the request fingerprint, the snapshot token and the keyset
 * position, signed. Filters are never stored: the caller re-supplies them with
 * the cursor, and a mismatch against `scope` is what rejects a reused cursor.
 */
export function sealCursor(kind: string, cursor: OpenedCursor): string {
  const body = Buffer.from(JSON.stringify([kind, cursor.scope, cursor.snapshot, ...cursor.position])).toString("base64url")
  return `${body}.${sign(body)}`
}

export function openCursor(cursor: string, kind: string): OpenedCursor | undefined {
  const [body, signature, extra] = cursor.split(".")
  if (body === undefined || signature === undefined || extra !== undefined) return undefined
  const expected = Buffer.from(sign(body))
  const received = Buffer.from(signature)
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined
  try {
    const value: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    if (!Array.isArray(value) || value.length < 3 || !value.every((part) => typeof part === "string")) return undefined
    const [storedKind, scope, snapshot, ...position] = value as string[]
    return storedKind === kind ? { scope: scope!, snapshot: snapshot!, position } : undefined
  } catch {
    return undefined
  }
}

/**
 * Open a cursor whose keyset position is a (sort key, id) pair and which must
 * accompany the request fingerprinted by `scope`. A cursor that is unsigned,
 * of another kind, missing either half or issued for another request is
 * rejected, so callers only have to compare the snapshot
 * ({@link assertCursorSnapshot}).
 */
export function openKeysetCursor(
  cursor: string,
  kind: string,
  bound: { readonly scope: string; readonly scopeMessage: string },
): { readonly position: readonly [string, string]; readonly snapshot: string } {
  const opened = openCursor(cursor, kind)
  const [key, id] = opened?.position ?? []
  if (opened === undefined || key === undefined || id === undefined) {
    throw new ValidationError("This cursor is not valid; call again without a cursor to start from the first page.")
  }
  if (opened.scope !== bound.scope) throw new ValidationError(bound.scopeMessage)
  return { position: [key, id], snapshot: opened.snapshot }
}

/** Reject a cursor whose sealed snapshot is not the current one, so a changed set is re-read from the start. */
export function assertCursorSnapshot(sealed: string, current: string, message: string): void {
  if (sealed !== cursorScope(current)) throw new ConflictError(message)
}

function sign(body: string): string {
  return createHmac("sha256", cursorKey).update(body).digest().subarray(0, SIGNATURE_BYTES).toString("base64url")
}
