import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EXIT_FAILED, EXIT_PASSED, EXIT_USAGE, runCli } from "../cli"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../runner/__tests__/browser_test_channel"
import type { BrowserChannel } from "@shared/types/BrowserChannel"

const PASSWORD = "cli-pass-4821"

let channel: BrowserChannel | undefined
let server: http.Server
let baseUrl: string
let heading = "Dashboard"
let dir: string

// The server comes first so `afterAll` always has one to close.
beforeAll(async () => {
  server = http.createServer((request, response) => {
    if (request.url === "/login") {
      response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Sign in</title>
<label for="email">Email</label><input id="email">
<label for="pw">Password</label><input id="pw" type="password">
<button onclick="location.href='/home'">Sign in</button>`)
    } else {
      response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Home</title><h1>${heading}</h1>`)
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
  channel = await findTestBrowser()
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  heading = "Dashboard"
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-cli-browser-"))
  const role = (name: string, value: string): Record<string, unknown> => ({ kind: "role", role: name, name: value })
  const steps = [
    { action: "navigate", url: "{{env.BASE_URL}}/login" },
    { action: "fill", locator: role("textbox", "Email"), value: "{{env.TEST_EMAIL}}" },
    { action: "fill", locator: { kind: "label", value: "Password" }, value: "{{secrets.TEST_PASSWORD}}" },
    { action: "click", locator: role("button", "Sign in") },
    { action: "expect-text", locator: { kind: "role", role: "heading" }, text: "Dashboard", match: "equals", timeoutMs: 2000 },
  ]
  const nodes = [
    { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
    ...steps.map((config, index) => ({ nodeId: `b${index + 1}`, type: "browser", label: `${config.action} ${index + 1}`, position: { x: 0, y: 0 }, config })),
    { nodeId: "end", type: "end", position: { x: 0, y: 0 } },
  ]
  const workflow = {
    workflowId: "wf_web",
    name: "Web login",
    description: "",
    nodes,
    edges: nodes.slice(1).map((next, index) => ({ edgeId: `e${index}`, source: nodes[index]!.nodeId, target: next.nodeId })),
    variables: {},
    tags: [],
    selectedEnvironmentId: null,
  }
  fs.writeFileSync(path.join(dir, "web.json"), JSON.stringify({ workflow }))
})

async function run(argv: readonly string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ""
  let stderr = ""
  const code = await runCli(argv, {
    env: { APIWEAVE_SECRET_TEST_PASSWORD: PASSWORD },
    cwd: dir,
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
  })
  return { code, stdout, stderr }
}

describe("apiweave run with browser steps", () => {
  it("rejects an unknown --browser", async () => {
    const result = await run(["run", "web.json", "--browser", "firefox"])
    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain("--browser must be chrome, msedge or chromium")
  })

  it("passes, then fails with exit 1 once the page changes", { timeout: BROWSER_TEST_TIMEOUT_MS }, async (context) => {
    if (channel === undefined) context.skip()
    const argv = ["run", "web.json", "--browser", channel!, "--var", `BASE_URL=${baseUrl}`, "--var", "TEST_EMAIL=ada@example.com"]

    const passed = await run(argv)
    expect(passed.stderr).toBe("")
    expect(passed.code).toBe(EXIT_PASSED)

    heading = "Something else"
    const failed = await run(argv)
    expect(failed.code).toBe(EXIT_FAILED)
    expect(failed.stdout).toContain("Browser step: the text of getByRole('heading') did not equal the expected text within 2s")
    expect(failed.stdout + failed.stderr).not.toContain(PASSWORD)
  })
})
