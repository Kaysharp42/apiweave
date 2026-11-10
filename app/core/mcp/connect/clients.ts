import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"
import { parse as parseToml } from "smol-toml"
import { resolveExecutable } from "../../agents/executable"
import { SERVER_NAME, type ConnectorContext, type ConnectorReading, type LauncherEntry, type McpClientConnector } from "./connector"
import { UnreadableConfigError, readJsoncEntry } from "./jsonc_file"
import { isRecord, jsonConnector, lastString, readStdioEntry } from "./json_connector"

/**
 * The six clients Connect your agents can register the launcher with. Every
 * path and command here is the client's documented user-level config:
 * project-level configs are repositories, and APIWeave never writes there.
 */

/** XDG config home, which OpenCode uses on every platform, and VS Code and Claude Desktop on Linux. */
function xdgConfig(context: ConnectorContext): string {
  return context.env["XDG_CONFIG_HOME"] || path.join(context.home, ".config")
}

/** Where per-user application data lives: %APPDATA%, ~/Library/Application Support, or XDG config. */
function appData(context: ConnectorContext): string {
  if (context.platform === "win32") return context.env["APPDATA"] || path.join(context.home, "AppData", "Roaming")
  if (context.platform === "darwin") return path.join(context.home, "Library", "Application Support")
  return xdgConfig(context)
}

const argsLauncher = (entry: Record<string, unknown>): string | undefined => lastString(entry["args"])

/** The plain stdio entry Cursor and Claude Desktop share, which has no `type` field. */
const argsEntry = ({ command, args }: LauncherEntry): Record<string, unknown> => ({ command, args: [...args] })

/**
 * The reading the two CLI-written clients share: an `apiweave` entry decides
 * the state, and without one only the client's own command on PATH says
 * whether it is installed at all.
 */
function readCliBacked(entry: unknown, command: string, context: ConnectorContext): ConnectorReading {
  const reading = readStdioEntry(entry, argsLauncher, context)
  if (reading !== null) return reading
  const installed = resolveExecutable(command, context.env) !== undefined
  return installed ? { state: "not-connected", detail: null } : { state: "not-installed", detail: `${command} was not found on PATH` }
}

// ---------------------------------------------------------------------------
// Claude Code: user scope is the top-level `mcpServers` of ~/.claude.json
// (inside CLAUDE_CONFIG_DIR when that is set). The file also holds Claude
// Code's own state, which it rewrites constantly, so APIWeave only reads it and
// writes through `claude mcp`. `add` refuses an existing name, hence the remove.
// ---------------------------------------------------------------------------
function claudeCodeConfig(context: ConnectorContext): string {
  const dir = context.env["CLAUDE_CONFIG_DIR"]
  return dir ? path.join(dir, ".claude.json") : path.join(context.home, ".claude.json")
}

const claudeCode: McpClientConnector = {
  clientId: "claude-code",
  name: "Claude Code",
  supported: () => true,
  configPath: claudeCodeConfig,
  read: (context) =>
    readCliBacked(readJsoncEntry(claudeCodeConfig(context), ["mcpServers", SERVER_NAME]), "claude", context),
  connect: async (context) => {
    await context.runCli("claude", ["mcp", "remove", SERVER_NAME, "--scope", "user"]).catch(() => undefined)
    await context.runCli("claude", ["mcp", "add", "--scope", "user", SERVER_NAME, "--", context.entry.command, ...context.entry.args])
  },
  disconnect: async (context) => {
    await context.runCli("claude", ["mcp", "remove", SERVER_NAME, "--scope", "user"])
  },
}

// ---------------------------------------------------------------------------
// Codex: `[mcp_servers.apiweave]` in $CODEX_HOME/config.toml. TOML is edited
// by `codex mcp add` (which replaces an existing name) and `codex mcp remove`;
// APIWeave only parses the file to read the entry.
// ---------------------------------------------------------------------------
function codexConfig(context: ConnectorContext): string {
  return path.join(context.env["CODEX_HOME"] || path.join(context.home, ".codex"), "config.toml")
}

function readCodexEntry(filePath: string): unknown {
  let text: string
  try {
    text = readFileSync(filePath, "utf8")
  } catch {
    return undefined
  }
  let servers: unknown
  try {
    servers = parseToml(text)["mcp_servers"]
  } catch (error) {
    throw new UnreadableConfigError(`${filePath} is not valid TOML: ${(error as Error).message.split("\n")[0]}`)
  }
  return isRecord(servers) ? servers[SERVER_NAME] : undefined
}

const codex: McpClientConnector = {
  clientId: "codex",
  name: "Codex",
  supported: () => true,
  configPath: codexConfig,
  read: (context) => readCliBacked(readCodexEntry(codexConfig(context)), "codex", context),
  connect: async (context) => {
    await context.runCli("codex", ["mcp", "add", SERVER_NAME, "--", context.entry.command, ...context.entry.args])
  },
  disconnect: async (context) => {
    await context.runCli("codex", ["mcp", "remove", SERVER_NAME])
  },
}

// ---------------------------------------------------------------------------
// OpenCode: the global opencode.jsonc or opencode.json under
// $OPENCODE_CONFIG_DIR, else $XDG_CONFIG_HOME/opencode, on every platform.
// When both files exist the .jsonc one wins, so that is the one edited. The
// flat `mcp.<name>` entry is the shape both OpenCode 1.x and 2.x accept.
// ---------------------------------------------------------------------------
function openCodeConfig(context: ConnectorContext): string {
  const dir = context.env["OPENCODE_CONFIG_DIR"] || path.join(xdgConfig(context), "opencode")
  const jsonc = path.join(dir, "opencode.jsonc")
  return existsSync(jsonc) ? jsonc : path.join(dir, "opencode.json")
}

const openCode = jsonConnector({
  clientId: "opencode",
  name: "OpenCode",
  configPath: openCodeConfig,
  serversKey: "mcp",
  entry: ({ command, args }) => ({ type: "local", command: [command, ...args], enabled: true }),
  launcherOf: (entry) => (entry["type"] === "local" ? lastString(entry["command"]) : undefined),
  installedHints: () => ({ commands: ["opencode"] }),
})

// ---------------------------------------------------------------------------
// Cursor: ~/.cursor/mcp.json, the global config on every platform.
// ---------------------------------------------------------------------------
const cursor = jsonConnector({
  clientId: "cursor",
  name: "Cursor",
  configPath: (context) => path.join(context.home, ".cursor", "mcp.json"),
  serversKey: "mcpServers",
  entry: argsEntry,
  launcherOf: argsLauncher,
  installedHints: (context) => ({ commands: ["cursor", "cursor-agent"], paths: [path.join(context.home, ".cursor")] }),
})

// ---------------------------------------------------------------------------
// VS Code: mcp.json in the default profile's user folder. JSONC.
// ---------------------------------------------------------------------------
function vsCodeUserDir(context: ConnectorContext): string {
  return path.join(appData(context), "Code", "User")
}

const vsCode = jsonConnector({
  clientId: "vscode",
  name: "VS Code",
  configPath: (context) => path.join(vsCodeUserDir(context), "mcp.json"),
  serversKey: "servers",
  entry: ({ command, args }) => ({ type: "stdio", command, args: [...args] }),
  launcherOf: argsLauncher,
  installedHints: (context) => ({ commands: ["code"], paths: [vsCodeUserDir(context)] }),
})

// ---------------------------------------------------------------------------
// Claude Desktop: claude_desktop_config.json in its app-data folder. The
// Windows build installed as an MSIX package reads a virtualized copy under
// %LOCALAPPDATA%\Packages\<Claude package>\LocalCache\Roaming\Claude and
// ignores %APPDATA%\Claude, so a package folder, when there is one, wins.
// ---------------------------------------------------------------------------
function claudeDesktopDir(context: ConnectorContext): string {
  if (context.platform === "win32") {
    const packages = path.join(context.env["LOCALAPPDATA"] || path.join(context.home, "AppData", "Local"), "Packages")
    const packaged = listDir(packages).find((name) => /^(Claude|AnthropicPBC\.Claude)_/i.test(name))
    if (packaged !== undefined) return path.join(packages, packaged, "LocalCache", "Roaming", "Claude")
  }
  return path.join(appData(context), "Claude")
}

const claudeDesktop = jsonConnector({
  clientId: "claude-desktop",
  name: "Claude Desktop",
  configPath: (context) => path.join(claudeDesktopDir(context), "claude_desktop_config.json"),
  serversKey: "mcpServers",
  entry: argsEntry,
  launcherOf: argsLauncher,
  installedHints: (context) => ({ paths: [claudeDesktopDir(context)] }),
})

export const MCP_CLIENT_CONNECTORS: readonly McpClientConnector[] = [claudeCode, codex, openCode, cursor, vsCode, claudeDesktop]

/**
 * Agents APIWeave launches whose per-session `apiweave` entry would be merged
 * into a user-level one of the same name, keyed by roster agentKey. Codex
 * deep-merges `-c` overrides into the entry and then rejects `url` on a stdio
 * server; OpenCode 1.x deep-merges config layers per server. Claude Code is
 * not here: it is launched with `--strict-mcp-config`, so its session config
 * replaces the user's outright.
 */
export const SESSION_MERGING_CLIENTS: Readonly<Record<string, string>> = { codex: "codex", opencode: "opencode" }

function listDir(dir: string): readonly string[] {
  try {
    return readdirSync(dir)
  } catch {
    return []
  }
}
