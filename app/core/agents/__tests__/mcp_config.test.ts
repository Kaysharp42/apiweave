import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { McpClientConfig } from "@shared/types/McpClientConfig"
import {
  MCP_CONFIG_SCRATCH,
  renderMcpConfigArgs,
  renderMcpConfigEnv,
  templatesReferencePath,
  writeAgentMcpConfig,
} from "../mcp_config"

let scratchDir: string

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-mcp-config-"))
})

afterEach(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true })
})

const CONFIG: McpClientConfig = { url: "http://127.0.0.1:47271/mcp", token: "secret-token", port: 47271 }

function written(format: "claude" | "qwen" = "claude"): Record<string, unknown> {
  const configPath = writeAgentMcpConfig(scratchDir, CONFIG, "sess_1", format)
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>
}

describe("MCP config file", () => {
  /** The shape Claude, Gemini and Copilot all read as-is. */
  it("writes the claude shape by default", () => {
    expect(written()).toEqual({
      mcpServers: {
        apiweave: {
          type: "http",
          url: CONFIG.url,
          headers: { Authorization: `Bearer ${CONFIG.token}` },
        },
      },
    })
  })

  /**
   * Qwen's `--mcp-config` does not normalize the Claude shape, and its bare
   * `url` key means SSE — so the file this agent gets names `httpUrl`, the one
   * key of its grammar that selects streamable HTTP.
   */
  it("writes the qwen shape when the definition asks for it", () => {
    expect(written("qwen")).toEqual({
      mcpServers: {
        apiweave: {
          httpUrl: CONFIG.url,
          headers: { Authorization: `Bearer ${CONFIG.token}` },
        },
      },
    })
  })

  it("names the file for the session, one config per session", () => {
    writeAgentMcpConfig(scratchDir, CONFIG, "sess_a")
    writeAgentMcpConfig(scratchDir, CONFIG, "sess_b")

    const names = fs.readdirSync(scratchDir)
    expect(names).toContain(MCP_CONFIG_SCRATCH.filename("sess_a"))
    expect(names).toContain(MCP_CONFIG_SCRATCH.filename("sess_b"))
  })
})

describe("renderMcpConfigArgs", () => {
  /** Claude, and every CLI that copied its convention. */
  it("substitutes the config path", () => {
    expect(renderMcpConfigArgs(["--mcp-config", "{path}"], "/tmp/x.json", CONFIG)).toEqual([
      "--mcp-config",
      "/tmp/x.json",
    ])
  })

  /**
   * The `@` is Copilot's file-input prefix and belongs to the template, not
   * the substitution — the launcher must not have to know which CLIs splice
   * the path into a larger argument.
   */
  it("substitutes into a larger argument", () => {
    expect(renderMcpConfigArgs(["@{path}"], "/tmp/x.json", CONFIG)).toEqual(["@/tmp/x.json"])
  })

  /**
   * Codex takes the URL in argv and the token by variable name — the rendered
   * argument must contain no quotes and no token, because argv is re-parsed by
   * `cmd.exe` and read by any process listing.
   */
  it("substitutes the url without quotes or token", () => {
    expect(renderMcpConfigArgs(["mcp_servers.apiweave.url={url}"], "", CONFIG)).toEqual([
      `mcp_servers.apiweave.url=${CONFIG.url}`,
    ])
  })
})

describe("renderMcpConfigEnv", () => {
  /** Gemini: a settings file named by a variable. */
  it("substitutes the config path", () => {
    expect(renderMcpConfigEnv({ GEMINI_CLI_SYSTEM_SETTINGS_PATH: "{path}" }, "/tmp/s.json", CONFIG)).toEqual({
      GEMINI_CLI_SYSTEM_SETTINGS_PATH: "/tmp/s.json",
    })
  })

  /** Codex: the token itself, and only ever in the environment. */
  it("substitutes the token", () => {
    expect(renderMcpConfigEnv({ APIWEAVE_MCP_TOKEN: "{token}" }, "", CONFIG)).toEqual({
      APIWEAVE_MCP_TOKEN: CONFIG.token,
    })
  })
})

describe("templatesReferencePath", () => {
  it("finds the reference in either half", () => {
    expect(templatesReferencePath(["--mcp-config", "{path}"], {})).toBe(true)
    expect(templatesReferencePath([], { GEMINI_CLI_SYSTEM_SETTINGS_PATH: "{path}" })).toBe(true)
    expect(templatesReferencePath(["url={url}"], { TOKEN: "{token}" })).toBe(false)
  })
})
