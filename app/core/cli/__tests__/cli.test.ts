import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EXIT_FAILED, EXIT_PASSED, EXIT_USAGE, runCli } from "../cli"

const FIXTURE = path.join(__dirname, "..", "__fixtures__", "smoke.awecollection")
const TOKEN = "s3cr3t-fixture-token"

let server: http.Server
let baseUrl: string
let received: string[]
let dir: string

beforeAll(async () => {
  server = http.createServer((request, response) => {
    received.push(request.headers.authorization ?? "")
    if (request.url === "/slow/health.json") {
      setTimeout(() => response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" })), 1000)
    } else if (request.url === "/health.json") {
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "ok" }))
    } else {
      // Echo the credential back, so a leak through the response would show.
      response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ status: "down", auth: request.headers.authorization }))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
})

beforeEach(() => {
  received = []
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-cli-"))
})

async function run(argv: readonly string[], env: Record<string, string> = {}): Promise<{ code: number; stdout: string; stderr: string }> {
  let stdout = ""
  let stderr = ""
  const code = await runCli(argv, {
    env,
    cwd: dir,
    stdout: { write: (text: string) => (stdout += text) },
    stderr: { write: (text: string) => (stderr += text) },
  })
  return { code, stdout, stderr }
}

describe("apiweave run", () => {
  it("passes a project bundle with the secret from the environment and exits 0", async () => {
    const result = await run(
      ["run", FIXTURE, "--env", "CI", "--var", `baseUrl=${baseUrl}`, "-r", "cli,junit"],
      { APIWEAVE_SECRET_API_TOKEN: TOKEN },
    )

    expect(result.stderr).toBe("")
    expect(result.code).toBe(EXIT_PASSED)
    expect(received).toEqual([`Bearer ${TOKEN}`])
    expect(result.stdout).toContain("✔ GET /health.json")
    expect(result.stdout).toContain("✔ Status is ok")
    expect(result.stdout).not.toContain("\u001b[")
    const junit = fs.readFileSync(path.join(dir, "apiweave-report.xml"), "utf8")
    expect(junit).toContain('tests="2" failures="0"')
  })

  it("fails on a failed assertion with exit 1 and a JUnit failure, never printing the secret", async () => {
    const junitPath = path.join(dir, "out", "junit.xml")
    const htmlPath = path.join(dir, "out", "report.html")
    const result = await run([
      "run", FIXTURE, "--env", "CI", "--var", `baseUrl=${baseUrl}/down`, "--secret", `API_TOKEN=${TOKEN}`,
      "--reporter-junit-export", junitPath, "--reporter-html-export", htmlPath,
    ])

    expect(result.code).toBe(EXIT_FAILED)
    expect(received).toEqual([`Bearer ${TOKEN}`])
    expect(result.stdout).toContain("✖ Status is ok")
    expect(result.stdout).toContain("1 of 1 assertion rules failed")
    const junit = fs.readFileSync(junitPath, "utf8")
    expect(junit).toContain('failures="1"')
    expect(junit).toContain('<failure message="1 of 1 assertion rules failed" type="AssertionError">')
    for (const output of [result.stdout, result.stderr, junit, fs.readFileSync(htmlPath, "utf8")]) {
      expect(output).not.toContain(TOKEN)
    }
  })

  it("runs a single workflow export, its environment and a dotenv secrets file", async () => {
    const project = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { workflows: unknown[]; environments: unknown[] }
    const exportFile = path.join(dir, "health.json")
    fs.writeFileSync(exportFile, JSON.stringify({ workflow: project.workflows[0], environments: project.environments }))
    fs.writeFileSync(path.join(dir, "secrets.env"), `API_TOKEN=${TOKEN}\n`)
    fs.writeFileSync(path.join(dir, "env.json"), JSON.stringify({ baseUrl }))

    const result = await run(["run", "health.json", "--env-file", "env.json", "--secrets-file", "secrets.env"])

    expect(result.code).toBe(EXIT_PASSED)
    expect(received).toEqual([`Bearer ${TOKEN}`])
  })

  it.each([
    [[], 2],
    [["--bail"], 1],
  ])("runs the next workflow after a failure unless --bail: %j", async (flags, requests) => {
    const project = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { workflows: { workflowId: string; name: string }[] }
    project.workflows.push({ ...project.workflows[0]!, workflowId: "wf_second", name: "Second" })
    fs.writeFileSync(path.join(dir, "two.awecollection"), JSON.stringify(project))

    const result = await run(["run", "two.awecollection", "--var", `baseUrl=${baseUrl}/down`, ...flags], { APIWEAVE_SECRET_API_TOKEN: TOKEN })

    expect(result.code).toBe(EXIT_FAILED)
    expect(received).toHaveLength(requests)
  })

  it("applies --timeout-request to every request", async () => {
    const result = await run(
      ["run", FIXTURE, "--env", "CI", "--var", `baseUrl=${baseUrl}/slow`, "--timeout-request", "50"],
      { APIWEAVE_SECRET_API_TOKEN: TOKEN },
    )

    expect(result.code).toBe(EXIT_FAILED)
    expect(result.stdout).toContain("Request timed out")
  })

  it("stops with exit 2 and names the missing secret before sending anything", async () => {
    const result = await run(["run", FIXTURE, "--env", "CI", "--var", `baseUrl=${baseUrl}`])

    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain("missing secret API_TOKEN")
    expect(result.stderr).toContain("APIWEAVE_SECRET_API_TOKEN")
    expect(received).toEqual([])
  })

  it.each([
    [["run", FIXTURE, "--env", "Prod"], "environment 'Prod' is not in the file (environments: CI)"],
    [["run", FIXTURE, "--workflow", "Nope"], "workflow 'Nope' is not in the project"],
    [["run", "missing.awecollection"], "cannot read"],
    [["run", FIXTURE, "--reporter", "xml"], "unknown reporter 'xml'"],
    [["run", FIXTURE, "--secret", TOKEN], "--secret expects KEY=value"],
    [["test", FIXTURE], "unknown command 'test'"],
    [["run", FIXTURE, "--nope"], "Unknown option '--nope'"],
  ])("exits 2 on a usage or config error: %j", async (argv, message) => {
    const result = await run(argv, { APIWEAVE_SECRET_API_TOKEN: TOKEN })

    expect(result.code).toBe(EXIT_USAGE)
    expect(result.stderr).toContain(message)
    expect(result.stderr).not.toContain(TOKEN)
    expect(received).toEqual([])
  })
})
