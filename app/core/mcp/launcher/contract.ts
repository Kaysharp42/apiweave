import { readFileSync, renameSync, writeFileSync } from "node:fs"
import type {
  Implementation,
  ListPromptsResult,
  ListResourceTemplatesResult,
  ListResourcesResult,
  ListToolsResult,
  ServerCapabilities,
} from "@modelcontextprotocol/sdk/types.js"

/**
 * What the desktop app and the stdio MCP launcher (`apiweave-mcp.cjs`) agree
 * on. The app copies the launcher into its user-data folder and leaves these
 * files beside it, so the launcher finds them next to itself: an agent's
 * config names one path and carries no token. Kept free of anything heavier
 * than `node:fs`, because the launcher bundles everything it imports.
 */

/** Loopback only — never 0.0.0.0. The whole security model rests on this. */
export const LOOPBACK_HOST = "127.0.0.1"
export const MCP_PATH = "/mcp"
/** The argument that starts the app in the tray, without a window. */
export const HIDDEN_ARG = "--hidden"

export const MCP_TOKEN_FILE = "mcp-token"
export const MCP_CATALOG_FILE = "mcp-catalog.json"
export const MCP_LAUNCH_FILE = "mcp-launch.json"
export const MCP_LAUNCHER_FILE = "apiweave-mcp.cjs"

/**
 * What the MCP server answers before any data is involved: its `initialize`
 * result and its four lists, all static for a given app version. Written by
 * the app each time its MCP server starts, so the launcher can answer an
 * agent's handshake at once while the app is still starting — or not running.
 */
export interface McpCatalog {
  readonly serverInfo: Implementation
  readonly capabilities: ServerCapabilities
  readonly instructions?: string
  readonly tools: ListToolsResult
  readonly resources: ListResourcesResult
  readonly resourceTemplates: ListResourceTemplatesResult
  readonly prompts: ListPromptsResult
}

/** How to start the app: its executable, plus the app folder when it runs from source. */
export interface McpLaunchCommand {
  readonly command: string
  readonly args: readonly string[]
}

export function readCatalog(filePath: string): McpCatalog | null {
  const parsed = readJsonFile(filePath)
  if (!isRecord(parsed) || !isRecord(parsed["capabilities"]) || !isRecord(parsed["tools"])) return null
  return parsed as unknown as McpCatalog
}

export function readLaunchCommand(filePath: string): McpLaunchCommand | null {
  const parsed = readJsonFile(filePath)
  if (!isRecord(parsed)) return null
  const { command, args } = parsed
  if (typeof command !== "string" || command === "") return null
  if (!Array.isArray(args) || !args.every((arg) => typeof arg === "string")) return null
  return { command, args }
}

/** Write through a temporary file, so a launcher reading at the same moment never sees half a file. */
export function writeJsonFile(filePath: string, value: unknown): void {
  const temporary = `${filePath}.${process.pid}.tmp`
  writeFileSync(temporary, JSON.stringify(value), { mode: 0o600 })
  renameSync(temporary, filePath)
}

function readJsonFile(filePath: string): unknown {
  try {
    return JSON.parse(readFileSync(filePath, "utf8"))
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
