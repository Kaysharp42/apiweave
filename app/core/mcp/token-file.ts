import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

/** Persisted MCP access info. The port is stored because a 47271 collision falls
 * back to an ephemeral port — clients (and the Setup dialog) must read the ACTUAL
 * bound port, never a hardcoded one. */
export interface McpTokenInfo {
  readonly token: string
  readonly port: number
}

/** 128-bit static per-install token, hex-encoded. */
export function generateToken(): string {
  return randomBytes(16).toString("hex")
}

/** Read the saved token, or null if the file is missing/unreadable/corrupt. Never
 * throws — a broken file just means "generate a fresh token". */
export function loadToken(filePath: string): string | null {
  let raw: string
  try {
    raw = readFileSync(filePath, "utf8")
  } catch {
    return null
  }
  try {
    const parsed: unknown = JSON.parse(raw)
    if (
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { token?: unknown }).token === "string" &&
      (parsed as { token: string }).token.length > 0
    ) {
      return (parsed as { token: string }).token
    }
  } catch {
    // fall through
  }
  return null
}

/** Persist `{ token, port }` (owner-only where the OS honours the mode). */
export function saveTokenInfo(filePath: string, info: McpTokenInfo): void {
  writeFileSync(filePath, JSON.stringify(info, null, 2), { mode: 0o600 })
}
