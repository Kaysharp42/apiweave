import { createHmac, randomBytes, timingSafeEqual } from "node:crypto"

// Process-local signing makes cursors tamper-proof and deliberately opaque to
// callers. A restart invalidates an outstanding cursor; clients can safely make
// a fresh bounded read in that case.
const cursorKey = randomBytes(32)

export function sealCursor(payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url")
  const signature = createHmac("sha256", cursorKey).update(body).digest("base64url")
  return `${body}.${signature}`
}

export function openCursor(cursor: string): Record<string, unknown> | undefined {
  const [body, signature, extra] = cursor.split(".")
  if (body === undefined || signature === undefined || extra !== undefined) return undefined
  const expected = createHmac("sha256", cursorKey).update(body).digest("base64url")
  const received = Buffer.from(signature)
  const expectedBuffer = Buffer.from(expected)
  if (received.length !== expectedBuffer.length || !timingSafeEqual(received, expectedBuffer)) return undefined
  try {
    const value: unknown = JSON.parse(Buffer.from(body, "base64url").toString("utf8"))
    return isRecord(value) ? value : undefined
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
