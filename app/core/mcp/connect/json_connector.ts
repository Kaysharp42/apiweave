import { existsSync } from "node:fs"
import path from "node:path"
import { resolveExecutable } from "../../agents/executable"
import { SERVER_NAME, type ConnectorContext, type ConnectorReading, type LauncherEntry, type McpClientConnector } from "./connector"
import { readJsoncEntry, writeJsoncEntry } from "./jsonc_file"

/** A client whose user config is one JSON(C) file APIWeave edits in place. */
export interface JsonConnectorSpec {
  readonly clientId: string
  readonly name: string
  readonly supported?: (context: ConnectorContext) => boolean
  readonly configPath: (context: ConnectorContext) => string
  /** The object key servers live under: `mcpServers`, `servers` or `mcp`. */
  readonly serversKey: string
  /** The entry in this client's own shape. */
  readonly entry: (launcher: LauncherEntry) => Record<string, unknown>
  /** The launcher path an existing entry runs, if it is a stdio entry at all. */
  readonly launcherOf: (entry: Record<string, unknown>) => string | undefined
  /** Signs the client is installed besides its config file existing: a CLI on PATH, or a folder. */
  readonly installedHints: (context: ConnectorContext) => { readonly commands?: readonly string[]; readonly paths?: readonly string[] }
}

export function jsonConnector(spec: JsonConnectorSpec): McpClientConnector {
  const keys = [spec.serversKey, SERVER_NAME]
  return {
    clientId: spec.clientId,
    name: spec.name,
    supported: (context) => spec.supported?.(context) ?? true,
    configPath: spec.configPath,
    read: (context): ConnectorReading => {
      const filePath = spec.configPath(context)
      const reading = readStdioEntry(readJsoncEntry(filePath, keys), spec.launcherOf, context)
      if (reading !== null) return reading
      return { state: isInstalled(spec, context, filePath) ? "not-connected" : "not-installed", detail: null }
    },
    connect: async (context) => {
      writeJsoncEntry(spec.configPath(context), keys, spec.entry(context.entry))
    },
    disconnect: async (context) => {
      writeJsoncEntry(spec.configPath(context), keys, undefined)
    },
  }
}

function isInstalled(spec: JsonConnectorSpec, context: ConnectorContext, filePath: string): boolean {
  if (existsSync(filePath)) return true
  const hints = spec.installedHints(context)
  if (hints.paths?.some((candidate) => existsSync(candidate)) === true) return true
  return hints.commands?.some((command) => resolveExecutable(command, context.env) !== undefined) === true
}

/**
 * An existing `apiweave` entry: connected when its last argument is this
 * install's launcher, outdated otherwise. Null when there is no entry.
 */
export function readStdioEntry(
  entry: unknown,
  launcherOf: (entry: Record<string, unknown>) => string | undefined,
  context: ConnectorContext,
): ConnectorReading | null {
  if (!isRecord(entry)) return null
  const runs = launcherOf(entry)
  if (runs !== undefined && samePath(runs, context.entry.args[0] ?? "", context.platform)) return { state: "connected", detail: null }
  return {
    state: "outdated",
    detail: runs === undefined ? "Has a direct HTTP entry, which fails whenever APIWeave is closed." : `Runs ${runs}.`,
  }
}

/** Windows and macOS file systems ignore case by default; Linux does not. */
export function samePath(a: string, b: string, platform: NodeJS.Platform): boolean {
  const normalize = (value: string): string => {
    const resolved = path.resolve(value)
    return platform === "linux" ? resolved : resolved.toLowerCase()
  }
  return a !== "" && b !== "" && normalize(a) === normalize(b)
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** The last string of `args` / `command` arrays: the launcher, in every shape APIWeave writes. */
export function lastString(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined
  const last: unknown = value[value.length - 1]
  return typeof last === "string" ? last : undefined
}
