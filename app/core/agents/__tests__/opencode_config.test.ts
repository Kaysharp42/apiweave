import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { McpClientConfig } from "@shared/types/McpClientConfig"
import { OPENCODE_CONFIG_SCRATCH, renderConfigEnv, writeOpenCodeSessionConfig } from "../opencode_config"

let scratchDir: string

beforeEach(() => {
  scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-opencode-config-"))
})

afterEach(() => {
  fs.rmSync(scratchDir, { recursive: true, force: true })
})

const MCP: McpClientConfig = { url: "http://127.0.0.1:47271/mcp", token: "secret-token", port: 47271 }

function written(briefingPath: string | null, mcp: McpClientConfig | null): Record<string, unknown> {
  const configPath = writeOpenCodeSessionConfig(scratchDir, "sess_1", briefingPath, mcp)
  return JSON.parse(fs.readFileSync(configPath, "utf8")) as Record<string, unknown>
}

describe("OpenCode launcher config", () => {
  /**
   * The whole point of the carrier: one file carries the two halves OpenCode
   * has no flags for — the bridge, and the briefing by path.
   */
  it("carries the bridge server and the briefing path in one file", () => {
    const config = written(path.join(scratchDir, "briefing-sess_1.md"), MCP)

    expect(config["instructions"]).toEqual([path.join(scratchDir, "briefing-sess_1.md")])
    expect(config["mcp"]).toEqual({
      apiweave: {
        enabled: true,
        type: "remote",
        url: MCP.url,
        headers: { Authorization: `Bearer ${MCP.token}` },
      },
    })
  })

  /**
   * OpenCode deep-merges config layers per server entry, so a key left unset
   * would leak in from a stale `apiweave` entry in the user's own config.
   * `enabled`, `url` and `headers` are the keys that matter; this pins all
   * three against that merge.
   */
  it("sets every mergeable key of the server entry explicitly", () => {
    const config = written(null, MCP)
    const server = (config["mcp"] as Record<string, unknown>)["apiweave"] as Record<string, unknown>

    expect(Object.keys(server).sort()).toEqual(["enabled", "headers", "type", "url"])
  })

  /**
   * The briefing travels by argv for agents with flags; for this carrier it
   * travels by path, and a launch without one writes no `instructions` key at
   * all rather than a dangling path to a file that does not exist.
   */
  it("omits the instructions key when there is no briefing", () => {
    const config = written(null, MCP)

    expect("instructions" in config).toBe(false)
  })

  /**
   * With the bridge off there is no server to name, and pointing at a dead
   * URL would surface as an error banner in the agent on every session. The
   * briefing still travels — it is the half that says the tools are absent.
   */
  it("omits the mcp key when the bridge is not running", () => {
    const config = written(path.join(scratchDir, "briefing-sess_1.md"), null)

    expect("mcp" in config).toBe(false)
    expect(config["instructions"]).toBeDefined()
  })

  it("names the file for the session, one config per session", () => {
    writeOpenCodeSessionConfig(scratchDir, "sess_a", null, MCP)
    writeOpenCodeSessionConfig(scratchDir, "sess_b", null, MCP)

    const names = fs.readdirSync(scratchDir)
    expect(names).toContain(OPENCODE_CONFIG_SCRATCH.filename("sess_a"))
    expect(names).toContain(OPENCODE_CONFIG_SCRATCH.filename("sess_b"))
  })
})

describe("renderConfigEnv", () => {
  /** The same `{path}` convention the argv carriers use, over a record. */
  it("substitutes the config path into each named variable", () => {
    expect(renderConfigEnv({ OPENCODE_CONFIG: "{path}" }, "C:/scratch/opencode-config-sess_1.json")).toEqual({
      OPENCODE_CONFIG: "C:/scratch/opencode-config-sess_1.json",
    })
  })

  it("leaves values without the placeholder alone", () => {
    expect(renderConfigEnv({ OPENCODE_CONFIG: "fixed" }, "/tmp/x.json")).toEqual({
      OPENCODE_CONFIG: "fixed",
    })
  })
})
