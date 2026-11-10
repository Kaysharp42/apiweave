import { randomBytes } from "node:crypto"
import { readFileSync, writeFileSync } from "node:fs"

/** Persisted MCP access info. The port is stored because a 47271 collision falls
 * back to an ephemeral port — clients (and the Setup dialog) must read the ACTUAL
 * bound port, never a hardcoded one. */
export interface McpTokenInfo {
  readonly token: string
  readonly port: number
}

/** 128-bit per-install token, hex-encoded. Kept across restarts; replaced only by `McpHost.regenerateToken`. */
export function generateToken(): string {
  return randomBytes(16).toString("hex")
}

/** Read the saved token, or null if the file is missing/unreadable/corrupt. Never
 * throws — a broken file just means "generate a fresh token". */
export function loadToken(filePath: string): string | null {
  const parsed = readTokenFile(filePath)
  return typeof parsed?.["token"] === "string" && parsed["token"].length > 0 ? parsed["token"] : null
}

/** The saved token and the port it was last served on, or null when either is missing. */
export function loadTokenInfo(filePath: string): McpTokenInfo | null {
  const token = loadToken(filePath)
  const port = readTokenFile(filePath)?.["port"]
  if (token === null || typeof port !== "number" || !Number.isInteger(port) || port <= 0) return null
  return { token, port }
}

function readTokenFile(filePath: string): Record<string, unknown> | null {
  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** Persist `{ token, port }` (owner-only where the OS honours the mode). */
export function saveTokenInfo(filePath: string, info: McpTokenInfo): void {
  writeFileSync(filePath, JSON.stringify(info, null, 2), { mode: 0o600 })
}
