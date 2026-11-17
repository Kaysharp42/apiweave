import fs from "node:fs"
import http from "node:http"
import https from "node:https"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EXIT_FAILED, EXIT_PASSED, EXIT_USAGE, runCli } from "../cli"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../runner/__tests__/browser_test_channel"
import { fixture, startConnectProxy } from "../../runner/__tests__/network_test_servers"
import type { BrowserChannel } from "@shared/types/BrowserChannel"

const PASSWORD = "cli-pass-4821"

let channel: BrowserChannel | undefined
let server: http.Server
let baseUrl: string
let secureServer: https.Server
let secureUrl: string
let heading = "Dashboard"
let dir: string

function page(request: http.IncomingMessage, response: http.ServerResponse): void {
  if (request.url === "/login") {
    response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Sign in</title>
<label for="email">Email</label><input id="email">
<label for="pw">Password</label><input id="pw" type="password">
<button onclick="location.href='/home'">Sign in</button>`)
  } else {
    response.writeHead(200, { "content-type": "text/html" }).end(`<!doctype html><title>Home</title><h1>${heading}</h1>`)
  }
}

async function listen(target: http.Server): Promise<number> {
  await new Promise<void>((resolve) => target.listen(0, "127.0.0.1", resolve))
  return (target.address() as AddressInfo).port
}

// The servers come first so `afterAll` always has them to close.
beforeAll(async () => {
  server = http.createServer(page)
  baseUrl = `http://127.0.0.1:${await listen(server)}`
  // Signed by the test CA, which no browser trusts: a dev server's self-signed certificate.
  secureServer = https.createServer({ cert: fixture("server.pem"), key: fixture("server.key") }, page)
  secureUrl = `https://127.0.0.1:${await listen(secureServer)}`
  channel = await findTestBrowser()
}, BROWSER_SEARCH_TIMEOUT_MS)

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  secureServer.closeAllConnections()
  await new Promise((resolve) => secureServer.close(resolve))
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
    const reports = ["--reporter", "cli,junit,html", "--reporter-junit-export", "reports/junit.xml", "--reporter-html-export", "reports/report.html"]
    const failed = await run([...argv, "--evidence-dir", "evidence", ...reports])
    expect(failed.code).toBe(EXIT_FAILED)
    expect(failed.stdout).toContain("Browser step: the text of getByRole('heading') did not equal the expected text within 2s")
    expect(failed.stdout).toContain('      Expected: "Dashboard"\n      Found: "Something else"\n')

    // The failed step's screenshot and ARIA snapshot, one folder per run, linked from every report.
    const [runDir, ...others] = fs.readdirSync(path.join(dir, "evidence"))
    expect(others).toEqual([])
    expect(fs.readdirSync(path.join(dir, "evidence", runDir!)).sort()).toEqual(["b5.aria.yml", "b5.jpg"])
    const shot = fs.readFileSync(path.join(dir, "evidence", runDir!, "b5.jpg"))
    expect(shot.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]))
    expect(fs.readFileSync(path.join(dir, "evidence", runDir!, "b5.aria.yml"), "utf8")).toContain("Something else")
    expect(failed.stdout).toContain(`      Screenshot: evidence/${runDir}/b5.jpg\n      ARIA snapshot: evidence/${runDir}/b5.aria.yml\n`)
    expect(fs.readFileSync(path.join(dir, "reports", "junit.xml"), "utf8")).toContain(`[[ATTACHMENT|evidence/${runDir}/b5.jpg]]`)
    expect(fs.readFileSync(path.join(dir, "reports", "report.html"), "utf8")).toContain(`<img class="shot" src="../evidence/${runDir}/b5.jpg"`)

    const everything = [failed.stdout, failed.stderr, ...["reports/junit.xml", "reports/report.html", `evidence/${runDir}/b5.aria.yml`].map((file) => fs.readFileSync(path.join(dir, file), "utf8"))]
    for (const text of everything) expect(text).not.toContain(PASSWORD)
  })

  it("opens a page whose certificate is not trusted only with --insecure, through --proxy", { timeout: BROWSER_TEST_TIMEOUT_MS }, async (context) => {
    if (channel === undefined) context.skip()
    const proxy = await startConnectProxy()
    try {
      const argv = ["run", "web.json", "--browser", channel!, "--var", `BASE_URL=${secureUrl}`, "--var", "TEST_EMAIL=ada@example.com", "--proxy", proxy.url]

      const refused = await run(argv)
      expect(refused.code).toBe(EXIT_FAILED)
      expect(refused.stdout).toMatch(/✖ navigate 1/)

      const insecure = await run([...argv, "--insecure"])
      expect(insecure.stdout).toContain("✔ expect-text 5")
      expect(insecure.code).toBe(EXIT_PASSED)
      // The pages went through the proxy, as requests do.
      expect(proxy.tunnels).toContain(new URL(secureUrl).host)
    } finally {
      await proxy.close()
    }
  })
})
