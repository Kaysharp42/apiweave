import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto"

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

function sign(body: string): string {
  return createHmac("sha256", cursorKey).update(body).digest().subarray(0, SIGNATURE_BYTES).toString("base64url")
}
