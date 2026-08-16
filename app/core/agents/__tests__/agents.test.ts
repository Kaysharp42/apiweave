import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { AgentDefinition } from "@shared/types/AgentDefinition"
import { detectAgent } from "../agent_detection"
import { resolveExecutable, spawnCommandFor } from "../executable"
import { AGENT_MCP_CONFIG_FILENAME, renderMcpConfigArgs, writeAgentMcpConfig } from "../mcp_config"

const isWindows = process.platform === "win32"

let tempRoot: string
let binDir: string

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-agents-"))
  binDir = path.join(tempRoot, "bin")
  fs.mkdirSync(binDir)
})

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true })
})

/** A runnable stub agent, in whatever form the host platform can actually execute. */
function writeStubAgent(name: string, body: { readonly stdout?: string; readonly stderr?: string; readonly exitCode: number }): string {
  if (isWindows) {
    const file = path.join(binDir, `${name}.cmd`)
    const lines = ["@echo off"]
    if (body.stdout !== undefined) lines.push(`echo ${body.stdout}`)
    if (body.stderr !== undefined) lines.push(`echo ${body.stderr} 1>&2`)
    lines.push(`exit /b ${body.exitCode}`)
    fs.writeFileSync(file, `${lines.join("\r\n")}\r\n`)
    return file
  }
  const file = path.join(binDir, name)
  const lines = ["#!/bin/sh"]
  if (body.stdout !== undefined) lines.push(`echo "${body.stdout}"`)
  if (body.stderr !== undefined) lines.push(`echo "${body.stderr}" 1>&2`)
  lines.push(`exit ${body.exitCode}`)
  fs.writeFileSync(file, `${lines.join("\n")}\n`, { mode: 0o755 })
  return file
}

function envWithBin(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: binDir, Path: binDir }
}

function definition(overrides: Partial<AgentDefinition>): AgentDefinition {
  return {
    agentKey: "stub",
    name: "Stub",
    detectCmd: "stub",
    argv: [],
    expectedProcess: "stub",
    env: {},
    promptMode: "none",
    promptFlag: null,
    mcpConfigArgs: [],
    unsupportedPlatforms: [],
    installUrl: null,
    ...overrides,
  }
}

describe("resolveExecutable", () => {
  it("finds a command on PATH and returns an absolute path", () => {
    const expected = writeStubAgent("found", { exitCode: 0 })
    expect(resolveExecutable("found", envWithBin())).toBe(expected)
  })

  it("returns undefined for a command that is not there", () => {
    expect(resolveExecutable("definitely-not-installed", envWithBin())).toBeUndefined()
  })

  /**
   * The npm-installed agents land on PATH as an extensionless shim next to the
   * real `.cmd`. Node cannot execute the extensionless one at all, so PATHEXT
   * candidates have to be tried first or every launch is an ENOENT.
   */
  it.runIf(isWindows)("prefers the PATHEXT form over a same-named extensionless shim", () => {
    writeStubAgent("shimmed", { exitCode: 0 })
    fs.writeFileSync(path.join(binDir, "shimmed"), "#!/usr/bin/env node\n")

    expect(resolveExecutable("shimmed", envWithBin())).toBe(path.join(binDir, "shimmed.cmd"))
  })

  it("treats an explicit path as a path rather than a PATH lookup", () => {
    const stub = writeStubAgent("explicit", { exitCode: 0 })
    // Empty PATH: an explicit path must still resolve.
    expect(resolveExecutable(stub, { PATH: "", Path: "" })).toBe(stub)
  })
})

describe("spawnCommandFor", () => {
  it("spawns a native executable directly, arguments untouched", () => {
    const command = spawnCommandFor("/usr/local/bin/claude", ["--version", "hello world"])
    expect(command.file).toBe("/usr/local/bin/claude")
    expect(command.args).toEqual(["--version", "hello world"])
  })

  /**
   * A `.cmd` is not an executable: bare it gives ENOENT, explicit it gives
   * EINVAL since the CVE-2024-27980 fix. `cmd.exe /c` is the only way to run
   * one — and it stays an argv, never a concatenated string.
   */
  it.runIf(isWindows)("routes a .cmd shim through cmd.exe", () => {
    const command = spawnCommandFor("C:\\npm\\opencode.cmd", ["--version"], { COMSPEC: "C:\\Windows\\cmd.exe" })
    expect(command.file).toBe("C:\\Windows\\cmd.exe")
    expect(command.args).toEqual(["/c", "C:\\npm\\opencode.cmd", "--version"])
  })
})

describe("detectAgent — three states, not two", () => {
  it("reports not-found when the binary is absent", async () => {
    const result = await detectAgent(definition({ detectCmd: "definitely-not-installed" }), envWithBin())
    expect(result.state).toBe("not-found")
    expect(result.resolvedPath).toBeNull()
  })

  it("reports ready when the version probe succeeds", async () => {
    writeStubAgent("stub", { stdout: "stub 1.2.3", exitCode: 0 })
    const result = await detectAgent(definition({}), envWithBin())

    expect(result.state).toBe("ready")
    expect(result.detail).toContain("1.2.3")
  })

  /**
   * The case a presence-only check gets wrong. Measured for real: `opencode`
   * resolves on PATH and then fails every invocation because its postinstall
   * never ran. Showing it as available would launch a dead process.
   */
  it("reports broken, with the failure text, when the binary is there but does not run", async () => {
    writeStubAgent("stub", { stderr: "postinstall script was not run", exitCode: 1 })
    const result = await detectAgent(definition({}), envWithBin())

    expect(result.state).toBe("broken")
    expect(result.resolvedPath).not.toBeNull()
    expect(result.detail).toContain("postinstall")
  })

  it("reports unsupported without probing at all", async () => {
    writeStubAgent("stub", { exitCode: 0 })
    const result = await detectAgent(definition({ unsupportedPlatforms: [process.platform] }), envWithBin())

    expect(result.state).toBe("unsupported")
    expect(result.resolvedPath).toBeNull()
  })
})

describe("MCP wiring", () => {
  /**
   * The token grants every whitelisted MCP tool, and the working directory is a
   * git repository — so the config goes to APIWeave's own userData, never
   * beside the user's code.
   */
  it("writes the config into the given directory and keeps the token out of argv", () => {
    const configDir = path.join(tempRoot, "agent-files")
    const written = writeAgentMcpConfig(configDir, {
      url: "http://127.0.0.1:47271/mcp",
      token: "secret-token",
      port: 47271,
    })

    expect(written).toBe(path.join(configDir, AGENT_MCP_CONFIG_FILENAME))
    const parsed = JSON.parse(fs.readFileSync(written, "utf8")) as {
      mcpServers: { apiweave: { url: string; headers: Record<string, string> } }
    }
    expect(parsed.mcpServers.apiweave.url).toBe("http://127.0.0.1:47271/mcp")
    expect(parsed.mcpServers.apiweave.headers["Authorization"]).toBe("Bearer secret-token")

    const args = renderMcpConfigArgs(["--mcp-config", "{path}", "--strict-mcp-config"], written)
    expect(args).toEqual(["--mcp-config", written, "--strict-mcp-config"])
    expect(args.join(" ")).not.toContain("secret-token")
  })

  /**
   * The template syntax exists for both spellings the world uses: a path as
   * its own argument, and one spliced into an existing argument.
   */
  it("fills {path} whether it stands alone or inside an argument", () => {
    expect(renderMcpConfigArgs(["--mcp-config={path}"], "/tmp/apiweave.json")).toEqual([
      "--mcp-config=/tmp/apiweave.json",
    ])
    expect(renderMcpConfigArgs(["--config", "{path}"], "/tmp/apiweave.json")).toEqual([
      "--config",
      "/tmp/apiweave.json",
    ])
  })
})
