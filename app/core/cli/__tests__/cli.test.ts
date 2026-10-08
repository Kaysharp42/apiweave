import fs from "node:fs"
import http from "node:http"
import os from "node:os"
import path from "node:path"
import type { AddressInfo } from "node:net"
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest"
import { EXIT_FAILED, EXIT_PASSED, EXIT_USAGE, runCli } from "../cli"
import { startFakeOAuthServer } from "../../runner/__tests__/oauth_fake_server"

const FIXTURE = path.join(__dirname, "..", "__fixtures__", "smoke.awecollection")
const TOKEN = "s3cr3t-fixture-token"

let server: http.Server
let baseUrl: string
let received: string[]
/** `<path> <x-user header>` of every request, for data-driven runs. */
let requests: string[]
let dir: string

beforeAll(async () => {
  server = http.createServer((request, response) => {
    received.push(request.headers.authorization ?? "")
    requests.push(`${request.url} ${request.headers["x-user"] ?? ""}`)
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
  requests = []
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

  describe("OAuth 2.0", () => {
    /** The fixture's workflow, its request authenticated with `oauth2` against `url`. */
    function oauthWorkflow(url: string, oauth2: Record<string, unknown>): string {
      const project = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { workflows: { nodes: { nodeId: string; config?: object }[] }[] }
      const workflow = project.workflows[0]!
      workflow.nodes = workflow.nodes
        .filter((node) => node.nodeId !== "check-status")
        .map((node) => (node.nodeId === "get-health" ? { ...node, config: { url: `${url}/api`, auth: { type: "oauth2", oauth2 } } } : node))
      fs.writeFileSync(path.join(dir, "oauth.json"), JSON.stringify({ workflow }))
      return "oauth.json"
    }

    it("runs a client-credentials workflow, fetching one token for every iteration and never printing it", async () => {
      const idp = await startFakeOAuthServer()
      try {
        const file = oauthWorkflow(idp.url, {
          grantType: "client_credentials",
          tokenUrl: `${idp.url}/token`,
          clientId: "ci",
          clientSecret: "{{secrets.CLIENT_SECRET}}",
          clientAuth: "body",
        })
        const result = await run(["run", file, "-n", "2", "-r", "cli,junit"], { APIWEAVE_SECRET_CLIENT_SECRET: "ci-secret-value" })

        expect(result.stderr).toBe("")
        expect(result.code).toBe(EXIT_PASSED)
        expect(idp.tokenCalls).toHaveLength(1)
        expect(idp.tokenCalls[0]!.form.get("client_secret")).toBe("ci-secret-value")
        expect(idp.apiCalls).toEqual(["Bearer tok-1-abcdef", "Bearer tok-1-abcdef"])
        const junit = fs.readFileSync(path.join(dir, "apiweave-report.xml"), "utf8")
        for (const output of [result.stdout, junit]) {
          expect(output).not.toContain("tok-1-abcdef")
          expect(output).not.toContain("ci-secret-value")
        }
      } finally {
        await idp.close()
      }
    })

    it("uses a refresh token given as the token secret for an authorization-code workflow", async () => {
      const idp = await startFakeOAuthServer()
      try {
        const file = oauthWorkflow(idp.url, {
          grantType: "authorization_code",
          authorizationUrl: `${idp.url}/authorize`,
          tokenUrl: `${idp.url}/token`,
          clientId: "ci",
          tokenSecret: "{{secrets.API_OAUTH}}",
        })
        const result = await run(["run", file], { APIWEAVE_SECRET_API_OAUTH: "ci-refresh-token" })

        expect(result.code).toBe(EXIT_PASSED)
        expect(Object.fromEntries(idp.tokenCalls[0]!.form)).toEqual({ grant_type: "refresh_token", refresh_token: "ci-refresh-token", client_id: "ci" })
        expect(idp.apiCalls).toEqual(["Bearer tok-1-abcdef"])
      } finally {
        await idp.close()
      }
    })
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

  it("runs a Call Workflow node against the imported copy of its target", async () => {
    const project = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as { workflows: object[] }
    project.workflows.push({
      workflowId: "wf_caller",
      name: "Caller",
      description: "",
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
        { nodeId: "call", type: "workflow", label: "Call health", position: { x: 240, y: 0 }, config: { targetWorkflowId: "wf_health" } },
        { nodeId: "end", type: "end", position: { x: 480, y: 0 } },
      ],
      edges: [
        { edgeId: "e1", source: "start", target: "call" },
        { edgeId: "e2", source: "call", target: "end" },
      ],
      variables: {},
      tags: [],
      selectedEnvironmentId: "env_ci",
    })
    fs.writeFileSync(path.join(dir, "calls.awecollection"), JSON.stringify(project))

    const result = await run(
      ["run", "calls.awecollection", "--workflow", "Caller", "--var", `baseUrl=${baseUrl}`],
      { APIWEAVE_SECRET_API_TOKEN: TOKEN },
    )

    expect(result.stderr).toBe("")
    expect(result.code).toBe(EXIT_PASSED)
    expect(received).toEqual([`Bearer ${TOKEN}`])
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

  describe("data-driven runs", () => {
    /** The fixture project with its request reading `{{data.file}}` and `{{data.user}}`. */
    function writeDataProject(): void {
      const project = JSON.parse(fs.readFileSync(FIXTURE, "utf8")) as {
        workflows: { nodes: { nodeId: string; config?: { url?: string; headers?: { key: string; value: string }[] } }[] }[]
      }
      const request = project.workflows[0]!.nodes.find((node) => node.nodeId === "get-health")!
      request.config!.url = "{{env.baseUrl}}/{{data.file}}"
      request.config!.headers!.push({ key: "X-User", value: "{{data.user}}" })
      fs.writeFileSync(path.join(dir, "data.awecollection"), JSON.stringify(project))
    }

    it("runs once per CSV row, each with its own values", async () => {
      writeDataProject()
      fs.writeFileSync(path.join(dir, "rows.csv"), 'file,user\r\nhealth.json,ann\r\nhealth.json,"bob, jr"\r\nhealth.json,cy\r\n')

      const result = await run(["run", "data.awecollection", "-d", "rows.csv", "--var", `baseUrl=${baseUrl}`, "-r", "cli,junit"], {
        APIWEAVE_SECRET_API_TOKEN: TOKEN,
      })

      expect(result.stderr).toBe("")
      expect(result.code).toBe(EXIT_PASSED)
      expect(requests).toEqual(["/health.json ann", "/health.json bob, jr", "/health.json cy"])
      expect(result.stdout).toContain("Health check [iteration 3]")
      expect(result.stdout).toMatch(/Iterations\s+3\s+3\s+0/)
      const junit = fs.readFileSync(path.join(dir, "apiweave-report.xml"), "utf8")
      expect(junit.match(/<testsuite /g)).toHaveLength(3)
      expect(junit).toContain('<testsuite name="Health check [iteration 2]"')
    })

    it("exits 1 when one iteration fails, runs the rest, and the JUnit report names it", async () => {
      writeDataProject()
      fs.writeFileSync(path.join(dir, "rows.json"), JSON.stringify([
        { file: "health.json", user: "ann" },
        { file: "down", user: "bob" },
        { file: "health.json", user: "cy" },
      ]))

      const result = await run(["run", "data.awecollection", "--iteration-data", "rows.json", "--var", `baseUrl=${baseUrl}`, "-r", "junit"], {
        APIWEAVE_SECRET_API_TOKEN: TOKEN,
      })

      expect(result.code).toBe(EXIT_FAILED)
      expect(requests).toHaveLength(3)
      const junit = fs.readFileSync(path.join(dir, "apiweave-report.xml"), "utf8")
      expect(junit).toMatch(/<testsuite name="Health check \[iteration 2\]"[^>]* failures="1"/)
      expect(junit).toMatch(/<testsuite name="Health check \[iteration 3\]"[^>]* failures="0"/)
    })

    it("stops at the first failed iteration with --bail", async () => {
      writeDataProject()
      fs.writeFileSync(path.join(dir, "rows.csv"), "file,user\nhealth.json,ann\ndown,bob\nhealth.json,cy\n")

      const result = await run(["run", "data.awecollection", "-d", "rows.csv", "--bail", "--var", `baseUrl=${baseUrl}`], {
        APIWEAVE_SECRET_API_TOKEN: TOKEN,
      })

      expect(result.code).toBe(EXIT_FAILED)
      expect(requests).toEqual(["/health.json ann", "/down bob"])
      expect(result.stdout).not.toContain("[iteration 3]")
    })

    it("runs a single workflow n times with --iteration-count, or the data's first n rows", async () => {
      const plain = await run(["run", FIXTURE, "-n", "2", "--var", `baseUrl=${baseUrl}`], { APIWEAVE_SECRET_API_TOKEN: TOKEN })
      expect(plain.code).toBe(EXIT_PASSED)
      expect(requests).toHaveLength(2)

      requests = []
      writeDataProject()
      fs.writeFileSync(path.join(dir, "rows.csv"), "file,user\nhealth.json,ann\nhealth.json,bob\nhealth.json,cy\n")
      const cut = await run(["run", "data.awecollection", "-d", "rows.csv", "-n", "2", "--var", `baseUrl=${baseUrl}`], { APIWEAVE_SECRET_API_TOKEN: TOKEN })
      expect(cut.code).toBe(EXIT_PASSED)
      expect(requests).toEqual(["/health.json ann", "/health.json bob"])
    })

    it.each([
      ["rows.csv", "file,user\nhealth.json\n", "--iteration-data: CSV row 1 has 1 fields"],
      ["rows.json", "{}", "--iteration-data: JSON data must be an array of objects"],
      ["missing.csv", null, "--iteration-data: cannot read"],
    ])("exits 2 on a bad data file: %s", async (name, text, message) => {
      if (text !== null) fs.writeFileSync(path.join(dir, name), text)

      const result = await run(["run", FIXTURE, "-d", name], { APIWEAVE_SECRET_API_TOKEN: TOKEN })

      expect(result.code).toBe(EXIT_USAGE)
      expect(result.stderr).toContain(message)
      expect(requests).toEqual([])
    })
  })
})
