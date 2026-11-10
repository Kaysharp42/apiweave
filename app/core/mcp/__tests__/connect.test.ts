import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
import { AgentMcpConnectService } from "../connect/service"
import { MCP_CLIENT_CONNECTORS } from "../connect/clients"
import type { ConnectorContext } from "../connect/connector"

let root: string
let home: string
let env: NodeJS.ProcessEnv
let cliCalls: string[][]
const launcherPath = "/data/APIWeave/apiweave-mcp.cjs"

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "apiweave-connect-"))
  home = join(root, "home")
  mkdirSync(home)
  // PATH holds only the test's own node, so no client CLI installed on this machine is seen.
  env = { PATH: dirname(process.execPath), XDG_CONFIG_HOME: join(root, "xdg"), CODEX_HOME: join(root, "codex"), CLAUDE_CONFIG_DIR: join(root, "claude") }
  cliCalls = []
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

function service(platform: NodeJS.Platform = "linux"): AgentMcpConnectService {
  return new AgentMcpConnectService({
    launcherPath,
    env,
    home,
    platform,
    runCli: async (command, args) => {
      cliCalls.push([command, ...args])
      return ""
    },
  })
}

function context(platform: NodeJS.Platform): ConnectorContext {
  return { platform, home, env, entry: { command: "node", args: [launcherPath] }, runCli: async () => "" }
}

const openCodeFile = (): string => join(root, "xdg", "opencode", "opencode.json")

async function stateOf(clientId: string, platform: NodeJS.Platform = "linux"): Promise<string | undefined> {
  return (await service(platform).list()).clients.find((client) => client.clientId === clientId)?.state
}

describe("Connect your agents — JSON configs", () => {
  it("replaces an old HTTP entry in OpenCode's config and keeps everything else, comments included", async () => {
    mkdirSync(join(root, "xdg", "opencode"), { recursive: true })
    writeFileSync(
      openCodeFile(),
      '{\n  // mine\n  "theme": "dark",\n  "mcp": {\n    "apiweave": { "type": "remote", "url": "http://127.0.0.1:47271/mcp" },\n    "other": { "type": "local", "command": ["x"] }\n  }\n}\n',
    )
    expect(await stateOf("opencode")).toBe("outdated")

    await service().connect("opencode")

    const text = readFileSync(openCodeFile(), "utf8")
    expect(text).toContain("// mine")
    expect(text).toContain('"theme": "dark"')
    expect(text).toContain('"other"')
    expect(text).not.toContain("47271")
    expect(await stateOf("opencode")).toBe("connected")
  })

  it("writes each client's own entry shape", async () => {
    mkdirSync(join(home, ".cursor"))
    mkdirSync(join(root, "xdg", "Code", "User"), { recursive: true })
    mkdirSync(join(root, "xdg", "Claude"), { recursive: true })
    const connect = service()
    for (const id of ["opencode", "cursor", "vscode", "claude-desktop"]) await connect.connect(id)

    const read = (file: string): unknown => JSON.parse(readFileSync(file, "utf8"))
    const node = (await connect.list()).nodePath
    expect(read(openCodeFile())).toEqual({ mcp: { apiweave: { type: "local", command: [node, launcherPath], enabled: true } } })
    expect(read(join(home, ".cursor", "mcp.json"))).toEqual({ mcpServers: { apiweave: { command: node, args: [launcherPath] } } })
    expect(read(join(root, "xdg", "Code", "User", "mcp.json"))).toEqual({ servers: { apiweave: { type: "stdio", command: node, args: [launcherPath] } } })
    expect(read(join(root, "xdg", "Claude", "claude_desktop_config.json"))).toEqual({ mcpServers: { apiweave: { command: node, args: [launcherPath] } } })
  })

  it("removes only its own entry on disconnect", async () => {
    mkdirSync(join(home, ".cursor"))
    writeFileSync(join(home, ".cursor", "mcp.json"), JSON.stringify({ mcpServers: { github: { command: "gh-mcp" } } }))
    await service().connect("cursor")
    await service().disconnect("cursor")

    expect(JSON.parse(readFileSync(join(home, ".cursor", "mcp.json"), "utf8"))).toEqual({ mcpServers: { github: { command: "gh-mcp" } } })
    expect(await stateOf("cursor")).toBe("not-connected")
  })

  it("refuses to edit a file it cannot parse, and leaves it untouched", async () => {
    mkdirSync(join(home, ".cursor"))
    writeFileSync(join(home, ".cursor", "mcp.json"), "{ broken")

    await expect(service().connect("cursor")).rejects.toThrow(/not valid JSON/)
    expect(readFileSync(join(home, ".cursor", "mcp.json"), "utf8")).toBe("{ broken")
    const cursor = (await service().list()).clients.find((client) => client.clientId === "cursor")
    expect(cursor?.detail).toMatch(/not valid JSON/)
  })

  it("reports a client with no sign of it on the machine as not installed", async () => {
    expect(await stateOf("cursor")).toBe("not-installed")
  })

  it("uses the MSIX package's virtualized folder for Claude Desktop on Windows when there is one", () => {
    const claudeDesktop = MCP_CLIENT_CONNECTORS.find((connector) => connector.clientId === "claude-desktop")!
    env["APPDATA"] = join(root, "roaming")
    env["LOCALAPPDATA"] = join(root, "local")
    expect(claudeDesktop.configPath(context("win32"))).toBe(join(root, "roaming", "Claude", "claude_desktop_config.json"))

    mkdirSync(join(root, "local", "Packages", "Claude_pzs8sxrjxfjjc"), { recursive: true })
    expect(claudeDesktop.configPath(context("win32"))).toBe(
      join(root, "local", "Packages", "Claude_pzs8sxrjxfjjc", "LocalCache", "Roaming", "Claude", "claude_desktop_config.json"),
    )
  })
})

describe("Connect your agents — clients with their own CLI", () => {
  it("registers Claude Code through `claude mcp`, removing any old entry first", async () => {
    await service().connect("claude-code")

    const node = (await service().list()).nodePath!
    expect(cliCalls).toEqual([
      ["claude", "mcp", "remove", "apiweave", "--scope", "user"],
      ["claude", "mcp", "add", "--scope", "user", "apiweave", "--", node, launcherPath],
    ])
  })

  it("reads Claude Code's user entry from .claude.json in CLAUDE_CONFIG_DIR", async () => {
    mkdirSync(join(root, "claude"))
    writeFileSync(join(root, "claude", ".claude.json"), JSON.stringify({ mcpServers: { apiweave: { type: "stdio", command: "node", args: [launcherPath] } } }))
    expect(await stateOf("claude-code")).toBe("connected")
  })

  it("registers Codex through `codex mcp` and reads it back from config.toml", async () => {
    await service().connect("codex")
    expect(cliCalls[0]?.slice(0, 4)).toEqual(["codex", "mcp", "add", "apiweave"])

    mkdirSync(join(root, "codex"))
    writeFileSync(join(root, "codex", "config.toml"), `model = "x"\n\n[mcp_servers.apiweave]\ncommand = 'node'\nargs = ['${launcherPath}']\n`)
    expect(await stateOf("codex")).toBe("connected")
    expect(service().coversSession("codex")).toBe(true)
  })

  it("lets a launched Codex or OpenCode session rely on the user entry, but never Claude Code", async () => {
    expect(service().coversSession("codex")).toBe(false)
    await service().connect("opencode")
    expect(service().coversSession("opencode")).toBe(true)

    mkdirSync(join(root, "claude"))
    writeFileSync(join(root, "claude", ".claude.json"), JSON.stringify({ mcpServers: { apiweave: { command: "node", args: [launcherPath] } } }))
    // Claude Code is launched with --strict-mcp-config, so its session config never merges.
    expect(service().coversSession("claude")).toBe(false)
  })
})
