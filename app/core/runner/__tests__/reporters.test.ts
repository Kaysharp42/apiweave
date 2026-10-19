import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import type { ProjectRun } from "@shared/types/ProjectRun"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import { buildConsoleReport, buildHtmlReport, buildJUnitReport, writeReport, type ReportInput, type ReportWorkflow, type SingleReportInput } from "../reporters"

// -------------------- A strict little XML reader --------------------

interface XmlElement {
  readonly name: string
  readonly attrs: Record<string, string>
  readonly children: XmlElement[]
  text: string
}

function decode(value: string): string {
  if (/&(?!(amp|lt|gt|quot|apos|#\d+);)/.test(value)) throw new Error(`bare & in ${JSON.stringify(value)}`)
  return value
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
}

/** Parses the subset JUnit uses and throws on anything not well-formed. */
function parseXml(xml: string): XmlElement {
  const body = xml.replace(/^<\?xml version="1\.0" encoding="UTF-8"\?>\n/, "")
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(body)) throw new Error("control character in XML")
  const root: XmlElement = { name: "#root", attrs: {}, children: [], text: "" }
  const stack: XmlElement[] = [root]
  const token = /<(\/?)([A-Za-z][\w-]*)((?:\s+[\w-]+="[^"<]*")*)\s*(\/?)>|([^<]+)/gy
  let match: RegExpExecArray | null
  let consumed = 0
  while ((match = token.exec(body)) !== null) {
    consumed = token.lastIndex
    const [, closing, name, rawAttrs, selfClosing, text] = match
    const top = stack[stack.length - 1]!
    if (text !== undefined) {
      top.text += decode(text)
      continue
    }
    if (closing === "/") {
      if (top.name !== name) throw new Error(`</${name}> closes <${top.name}>`)
      stack.pop()
      continue
    }
    const attrs: Record<string, string> = {}
    for (const [, key, value] of (rawAttrs ?? "").matchAll(/([\w-]+)="([^"]*)"/g)) {
      if (key! in attrs) throw new Error(`duplicate attribute ${key}`)
      attrs[key!] = decode(value!)
    }
    const element: XmlElement = { name: name!, attrs, children: [], text: "" }
    top.children.push(element)
    if (selfClosing !== "/") stack.push(element)
  }
  if (consumed !== body.length) throw new Error(`unparsable XML at ${consumed}: ${body.slice(consumed, consumed + 40)}`)
  if (stack.length !== 1) throw new Error(`unclosed <${stack[stack.length - 1]!.name}>`)
  if (root.children.length !== 1 || root.text.trim() !== "") throw new Error("expected a single root element")
  return root.children[0]!
}

function all(element: XmlElement, name: string): XmlElement[] {
  return element.children.filter((child) => child.name === name)
}

// -------------------- Fixtures --------------------

function result(nodeId: string, overrides: Partial<RunResult> = {}): RunResult {
  return { nodeId, status: "passed", duration: 120, request: null, response: null, error: null, ...overrides }
}

function makeRun(overrides: Partial<Run> = {}): Run {
  return {
    runId: "run_1",
    workspaceId: "ws_1",
    workflowId: "wf_1",
    status: "completed",
    trigger: "manual",
    variables: {},
    results: [],
    nodeStatuses: {},
    startedAt: "2026-07-06T10:00:00.000Z",
    completedAt: "2026-07-06T10:00:05.000Z",
    duration: 5000,
    rev: 1,
    createdAt: "2026-07-06T10:00:00.000Z",
    updatedAt: "2026-07-06T10:00:05.000Z",
    ...overrides,
  }
}

const WORKFLOW: ReportWorkflow = {
  workflowId: "wf_1",
  name: "Users API",
  nodes: [
    { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
    { nodeId: "http_1", type: "http-request", label: "GET /users", position: { x: 1, y: 0 } },
    { nodeId: "check", type: "assertion", label: "Check users", position: { x: 2, y: 0 } },
    { nodeId: "end", type: "end", position: { x: 3, y: 0 } },
  ],
}

const FAILED_RUN = makeRun({
  status: "failed",
  failureMessage: "Workflow execution failed in 1 node",
  nodeStatuses: {
    start: { status: "passed" },
    http_1: { status: "passed" },
    check: { status: "failed", message: "Assertion failed: 1/2 rules failed" },
    end: { status: "skipped" },
  },
  results: [
    result("http_1", {
      duration: 250,
      request: { method: "GET", url: "https://api.example.com/users?<REDACTED>" },
      response: { statusCode: 200, headers: { "set-cookie": "sid=abc" }, body: { token: "server-issued" } },
    }),
    result("check", {
      status: "failed",
      duration: 3,
      assertions: [
        {
          ruleIndex: 0, source: "status", path: "", operator: "equals", sourceNodeId: "http_1",
          expectedState: "literal", expectedType: "number", actualState: "present", actualType: "number",
          outcome: "pass", reasonCode: "passed",
        },
        {
          ruleIndex: 1, source: "prev", path: "body.items.length", operator: "gt", sourceNodeId: "http_1",
          expectedState: "literal", expectedType: "number", actualState: "present", actualType: "number",
          outcome: "fail", reasonCode: "comparison-failed",
        },
      ],
    }),
  ],
})

// -------------------- JUnit --------------------

describe("buildJUnitReport — one workflow run", () => {
  it("is well-formed JUnit: testsuites > testsuite > testcase, times in seconds", () => {
    const root = parseXml(buildJUnitReport({ kind: "run", run: FAILED_RUN, workflow: WORKFLOW }))
    expect(root.name).toBe("testsuites")
    expect(root.attrs).toMatchObject({ name: "Users API", tests: "2", failures: "1", errors: "0", skipped: "0", time: "5.000" })
    const [suite, ...rest] = all(root, "testsuite")
    expect(rest).toHaveLength(0)
    expect(suite!.attrs).toMatchObject({ name: "Users API", tests: "2", failures: "1", skipped: "0", time: "5.000", timestamp: "2026-07-06T10:00:00.000Z" })
    // Start and End are not tests.
    const cases = all(suite!, "testcase")
    expect(cases.map((c) => [c.attrs["classname"], c.attrs["name"], c.attrs["time"]])).toEqual([
      ["Users API", "GET /users", "0.250"],
      ["Users API", "Check users", "0.003"],
    ])
    expect(cases[0]!.children).toEqual([])
    const [failure] = all(cases[1]!, "failure")
    expect(failure!.attrs).toEqual({ message: "1 of 2 assertion rules failed", type: "AssertionError" })
    expect(failure!.text).toContain("Rule 2: prev body.items.length gt — fail (comparison-failed)")
    expect(failure!.text).not.toContain("Rule 1")
  })

  it("fails a run that failed, was cancelled or interrupted with no failed node, so CI never reads it as green", () => {
    for (const status of ["failed", "cancelled", "interrupted"] as const) {
      const root = parseXml(buildJUnitReport({ kind: "run", run: makeRun({ status, error: null }), workflow: WORKFLOW }))
      const [testCase] = all(all(root, "testsuite")[0]!, "testcase")
      expect(testCase!.attrs["name"]).toBe("Run")
      expect(all(testCase!, "failure")[0]!.attrs["message"]).toBe(`Run ${status}`)
    }
  })

  it("reports a node that never finished as skipped, and names nodes by id when the workflow is gone", () => {
    const run = makeRun({ status: "cancelled", nodeStatuses: { http_1: { status: "running" }, gone: "skipped" } })
    const root = parseXml(buildJUnitReport({ kind: "run", run, workflow: null }))
    const suite = all(root, "testsuite")[0]!
    expect(suite.attrs["name"]).toBe("wf_1")
    const cases = all(suite, "testcase")
    expect(cases.map((c) => c.attrs["name"])).toEqual(["http_1", "gone", "Run"])
    expect(all(cases[0]!, "skipped")[0]!.attrs["message"]).toBe("Did not finish (running)")
    expect(all(cases[1]!, "skipped")).toHaveLength(1)
  })

  it("names an unexpected status code over the stored error class", () => {
    const run = makeRun({
      status: "failed",
      nodeStatuses: { http_1: { status: "failed" } },
      results: [result("http_1", { status: "failed", error: "Node execution failed", expectedStatus: [200, 201], response: { statusCode: 404 } })],
    })
    const testCase = all(all(parseXml(buildJUnitReport({ kind: "run", run, workflow: WORKFLOW })), "testsuite")[0]!, "testcase")[0]!
    expect(all(testCase, "failure")[0]!.attrs["message"]).toBe("Status 404, expected 200 or 201")
  })

  it("lists a retrying node's attempts, and counts them on the console", () => {
    const run = makeRun({
      status: "failed",
      nodeStatuses: { http_1: { status: "failed" } },
      results: [
        result("http_1", {
          status: "failed",
          error: "Condition not met after 3 attempts",
          response: { statusCode: 202 },
          attempts: [{ statusCode: 202, duration: 5 }, { duration: 1, error: "Request timed out" }, { statusCode: 202, duration: 4 }],
        }),
      ],
    })
    const input: ReportInput = { kind: "run", run, workflow: WORKFLOW }
    const testCase = all(all(parseXml(buildJUnitReport(input)), "testsuite")[0]!, "testcase")[0]!
    expect(all(testCase, "failure")[0]!.attrs["message"]).toBe("Condition not met after 3 attempts")
    expect(all(testCase, "failure")[0]!.text).toContain("Attempts 3: 202, no response, 202")
    expect(buildConsoleReport(input, false)).toContain("GET /users  0.120s · 3 attempts")
  })

  it("escapes hostile names and messages, and drops characters XML cannot carry", () => {
    const hostile = `<script>"x" & 'y' ]]></testcase>\u0001`
    const workflow: ReportWorkflow = { ...WORKFLOW, name: hostile, nodes: [{ nodeId: "n", type: "http-request", label: hostile, position: { x: 0, y: 0 } }] }
    const run = makeRun({
      status: "failed",
      nodeStatuses: { n: { status: "failed" } },
      results: [result("n", { status: "failed", error: `boom\n${hostile}` })],
    })
    const xml = buildJUnitReport({ kind: "run", run, workflow })
    expect(xml).not.toContain("<script>")
    expect(xml).not.toContain("]]>")
    const root = parseXml(xml)
    const suite = all(root, "testsuite")[0]!
    const expected = hostile.replace("\u0001", "�")
    expect(suite.attrs["name"]).toBe(expected)
    const testCase = all(suite, "testcase")[0]!
    expect(testCase.attrs["name"]).toBe(expected)
    const failure = all(testCase, "failure")[0]!
    expect(failure.attrs["message"]).toBe(`boom\n${expected}`)
    expect(failure.text).toContain(expected)
  })
})

describe("buildJUnitReport — project run", () => {
  const projectRun: ProjectRun = {
    projectRunId: "prun_1",
    projectId: "proj_1",
    environmentId: null,
    status: "failed",
    startedAt: "2026-07-06T10:00:00.000Z",
    finishedAt: "2026-07-06T10:00:09.000Z",
    items: [
      { workflowId: "wf_1", workflowName: "Users API", continueOnFail: false, runId: "run_1", status: "failed", durationMs: 5000 },
      { workflowId: "wf_2", workflowName: "Orders API", continueOnFail: false, runId: null, status: "skipped", durationMs: null },
      { workflowId: "wf_3", workflowName: "Deleted run", continueOnFail: true, runId: "run_gone", status: "completed", durationMs: 10 },
    ],
  }

  it("has one testsuite per workflow, in run order, with never-run workflows as one skipped case", () => {
    const input: ReportInput = { kind: "project", projectName: "Checkout", projectRun, runs: [FAILED_RUN], workflows: [WORKFLOW] }
    const root = parseXml(buildJUnitReport(input))
    expect(root.attrs).toMatchObject({ name: "Checkout", tests: "4", failures: "1", skipped: "2" })
    const suites = all(root, "testsuite")
    expect(suites.map((s) => [s.attrs["name"], s.attrs["tests"], s.attrs["failures"], s.attrs["skipped"]])).toEqual([
      ["Users API", "2", "1", "0"],
      ["Orders API", "1", "0", "1"],
      ["Deleted run", "1", "0", "1"],
    ])
    expect(all(all(suites[1]!, "testcase")[0]!, "skipped")[0]!.attrs["message"]).toMatch(/stopped before this workflow/)
    expect(all(all(suites[2]!, "testcase")[0]!, "skipped")[0]!.attrs["message"]).toMatch(/deleted from history/)
  })

  it("fails a failed workflow whose run is not stored, in every format", () => {
    const failedRun: ProjectRun = {
      ...projectRun,
      items: [
        { workflowId: "wf_1", workflowName: "Pruned run", continueOnFail: true, runId: "run_pruned", status: "failed", durationMs: 5000 },
        { workflowId: "wf_2", workflowName: "Workflow gone", continueOnFail: false, runId: null, status: "failed", durationMs: null },
      ],
    }
    const input: ReportInput = { kind: "project", projectName: "Checkout", projectRun: failedRun, runs: [], workflows: [] }
    const root = parseXml(buildJUnitReport(input))
    expect(root.attrs).toMatchObject({ tests: "2", failures: "2", skipped: "0" })
    for (const suite of all(root, "testsuite")) {
      expect(all(all(suite, "testcase")[0]!, "failure")[0]!.attrs["message"]).toMatch(/Workflow failed; its run record is unavailable/)
    }
    expect(buildHtmlReport(input)).toContain("<div><b>2</b>failed</div>")
    expect(buildConsoleReport(input, false)).toMatch(/Workflows\s+2\s+0\s+2\s+0/)
  })

  it("renders the same suites as HTML", () => {
    const html = buildHtmlReport({ kind: "project", projectName: "Checkout", projectRun, runs: [FAILED_RUN], workflows: [WORKFLOW] })
    expect(html.match(/<section>/g)).toHaveLength(3)
    expect(html).toContain("<h1>Checkout</h1>")
  })
})

// -------------------- HTML --------------------

describe("buildHtmlReport", () => {
  it("is one self-contained page: no script, no external asset", () => {
    const html = buildHtmlReport({ kind: "run", run: FAILED_RUN, workflow: WORKFLOW })
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true)
    expect(html).not.toMatch(/<script|<link|src=|https?:\/\/(?!api\.example\.com)/)
    expect(html).toContain("GET https://api.example.com/users?&lt;REDACTED&gt;")
    expect(html).toContain("Status 200")
    expect(html).toContain("Rule 2: prev body.items.length gt — fail (comparison-failed)")
  })

  it("escapes hostile names", () => {
    const hostile = `<img src=x onerror="alert(1)">`
    const html = buildHtmlReport({ kind: "run", run: makeRun({ nodeStatuses: { n: "passed" } }), workflow: { ...WORKFLOW, name: hostile, nodes: [{ nodeId: "n", type: "delay", label: hostile, position: { x: 0, y: 0 } }] } })
    expect(html).not.toContain("<img")
    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;")
  })
})

// -------------------- Exact output --------------------

describe("exact report text", () => {
  const SCRIPTED_WORKFLOW: ReportWorkflow = {
    ...WORKFLOW,
    nodes: [...WORKFLOW.nodes, { nodeId: "wait", type: "delay", position: { x: 4, y: 0 } }],
  }
  const rule = {
    sourceNodeId: "http_1", expectedState: "literal", expectedType: "object", actualState: "present", actualType: "object",
  } as const

  const SCRIPTED_RUN = makeRun({
    status: "running",
    error: null,
    nodeStatuses: { http_1: { status: "passed" }, check: { status: "failed" }, wait: "idle" },
    results: [
      result("http_1", {
        request: { url: "https://api.example.com/users" },
        response: { statusCode: 201 },
        assertions: [
          { ...rule, ruleIndex: 0, source: "status", path: "", operator: "equals", outcome: "pass", reasonCode: "passed", detail: "201" },
        ],
        scripts: [
          {
            phase: "preRequest", duration: 1, logs: ["before 1", "before 2"], error: "TypeError: x is undefined",
            tests: [{ name: "has id", passed: true }, { name: "quoted \"name\"", passed: false, error: "expected 1" }],
          },
          { phase: "postResponse", duration: 1, logs: ["after"], tests: [] },
        ],
      }),
      result("check", {
        status: "failed",
        error: null,
        assertions: [
          { ...rule, ruleIndex: 0, source: "prev", path: "body", operator: "matchesSchema", outcome: "fail", reasonCode: "schema-mismatch", schemaErrors: [{ path: "", message: "must be object" }, { path: "/id", message: "must be string" }] },
          { ...rule, ruleIndex: 1, source: "prev", path: "body.ok", operator: "equals", outcome: "pass", reasonCode: "passed" },
        ],
        scripts: [
          { phase: "postResponse", duration: 1, logs: ["checked"], error: "boom", tests: [{ name: "ok", passed: true }, { name: "bad", passed: false }] },
        ],
      }),
      result("orphan", { status: "skipped", duration: 0 }),
    ],
  })

  it("renders details, scripts, logs and schema errors byte for byte", () => {
    const input: ReportInput = { kind: "run", run: SCRIPTED_RUN, workflow: SCRIPTED_WORKFLOW }
    expect(buildJUnitReport(input)).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <testsuites name="Users API" tests="4" failures="1" errors="0" skipped="2" time="5.000">
        <testsuite name="Users API" id="0" tests="4" failures="1" errors="0" skipped="2" time="5.000" timestamp="2026-07-06T10:00:00.000Z">
          <testcase classname="Users API" name="GET /users" time="0.120">
            <system-out>before 1
      before 2
      after</system-out>
          </testcase>
          <testcase classname="Users API" name="Check users" time="0.120">
            <failure message="1 of 2 assertion rules failed" type="AssertionError">1 of 2 assertion rules failed
      Rule 1: prev body matchesSchema — fail (schema-mismatch)
        (root): must be object
        /id: must be string
      Post-response script error: boom
      Test "bad": failed — </failure>
            <system-out>checked</system-out>
          </testcase>
          <testcase classname="Users API" name="wait" time="0.000">
            <skipped message="Did not finish (idle)"/>
          </testcase>
          <testcase classname="Users API" name="orphan" time="0.000">
            <skipped/>
          </testcase>
        </testsuite>
      </testsuites>
      "
    `)
    expect(buildConsoleReport(input, false)).toMatchInlineSnapshot(`
      "Users API · running

      Users API · running · 5.000s
        ✔ GET /users   0.120s
        ✖ Check users  0.120s
            1 of 2 assertion rules failed
            Rule 1: prev body matchesSchema — fail (schema-mismatch)
              (root): must be object
              /id: must be string
            Post-response script error: boom
            Test "bad": failed — 
            > checked
        ○ wait         0.000s
            Did not finish (idle)
        ○ orphan       0.000s

                 total  passed  failed  skipped
      Workflows      1       0       1        0
      Steps          4       1       1        2
      Duration 5.000s
      "
    `)
    // HTML lists every case's details, so a passed node's show here.
    expect([...buildHtmlReport(input).matchAll(/<div class="(?:message|detail)">([^<]*)<\/div>|<pre class="logs">([^<]*)<\/pre>/g)].map((m) => m[1] ?? m[2])).toMatchInlineSnapshot(`
      [
        "https://api.example.com/users",
        "Status 201",
        "Rule 1: status equals — pass (passed: 201)",
        "Pre-request script error: TypeError: x is undefined",
        "Test &quot;has id&quot;: passed",
        "Test &quot;quoted \\&quot;name\\&quot;&quot;: failed — expected 1",
        "before 1
      before 2
      after",
        "1 of 2 assertion rules failed",
        "Rule 1: prev body matchesSchema — fail (schema-mismatch)",
        "  (root): must be object",
        "  /id: must be string",
        "Post-response script error: boom",
        "Test &quot;bad&quot;: failed — ",
        "checked",
        "Did not finish (idle)",
      ]
    `)
  })

  it("adds a skipped Run case to a live run with no failed node", () => {
    const input: ReportInput = { kind: "run", run: makeRun({ status: "pending", error: "Queued", duration: undefined, nodeStatuses: { http_1: "passed" } }), workflow: WORKFLOW }
    expect(buildJUnitReport(input)).toMatchInlineSnapshot(`
      "<?xml version="1.0" encoding="UTF-8"?>
      <testsuites name="Users API" tests="2" failures="0" errors="0" skipped="1" time="0.000">
        <testsuite name="Users API" id="0" tests="2" failures="0" errors="0" skipped="1" time="0.000" timestamp="2026-07-06T10:00:00.000Z">
          <testcase classname="Users API" name="GET /users" time="0.000"/>
          <testcase classname="Users API" name="Run" time="0.000">
            <skipped message="Queued"/>
          </testcase>
        </testsuite>
      </testsuites>
      "
    `)
    expect(buildConsoleReport(input, false)).toMatchInlineSnapshot(`
      "Users API · pending

      Users API · pending · 0.000s
        ✔ GET /users  0.000s
        ○ Run         0.000s
            Queued

                 total  passed  failed  skipped
      Workflows      1       0       1        0
      Steps          2       1       0        1
      Duration 0.000s
      "
    `)
  })
})

// -------------------- Repository run --------------------

describe("repository run — several projects", () => {
  const loginRun = (projectName: string, runId: string, status: Run["status"]): SingleReportInput => ({
    kind: "project",
    projectName,
    projectRun: {
      projectRunId: `prun_${runId}`,
      projectId: `proj_${runId}`,
      environmentId: null,
      status,
      startedAt: "2026-07-06T10:00:00.000Z",
      finishedAt: "2026-07-06T10:00:05.000Z",
      items: [{ workflowId: "wf_1", workflowName: "Login", continueOnFail: false, runId, status, durationMs: 5000 }],
    },
    runs: [makeRun({ runId, status, nodeStatuses: { http_1: "passed" } })],
    workflows: [WORKFLOW],
  })
  const input: ReportInput = {
    kind: "projects",
    title: "Acme QA",
    projects: [loginRun("Billing", "run_a", "completed"), loginRun("Shop", "run_b", "failed")],
  }

  it("flattens the suites in project order, each named after its project, under the workspace's name", () => {
    const root = parseXml(buildJUnitReport(input))
    expect(root.attrs["name"]).toBe("Acme QA")
    expect(all(root, "testsuite").map((suite) => suite.attrs["name"])).toEqual(["Billing: Login", "Shop: Login"])
    expect(buildHtmlReport(input)).toContain("<h1>Acme QA</h1>")
  })

  it("names a suite after its project even when only one project ran", () => {
    const root = parseXml(buildJUnitReport({ kind: "projects", title: "Acme QA", projects: [loginRun("Billing", "run_a", "completed")] }))
    expect(all(root, "testsuite").map((suite) => suite.attrs["name"])).toEqual(["Billing: Login"])
  })

  it("counts the projects in the summary, and calls nothing an iteration", () => {
    const text = buildConsoleReport(input, false)
    expect(text).toMatch(/Projects\s+2\s+1\s+1\s+0/)
    expect(text).not.toContain("Iterations")
    expect(text.split("\n")[0]).toBe("Acme QA · failed")
  })

  it("still counts iterations of a data-driven run as iterations", () => {
    const text = buildConsoleReport({ kind: "iterations", title: "Users API", iterations: [{ kind: "run", run: makeRun(), workflow: WORKFLOW }] }, false)
    expect(text).toMatch(/Iterations\s+1\s+1\s+0\s+0/)
    expect(text).not.toContain("Projects")
  })
})

// -------------------- What a report carries --------------------

describe("report contents", () => {
  it("carries no headers, bodies or variables, even when the stored run holds them", () => {
    const run = makeRun({
      ...FAILED_RUN,
      variables: { sessionToken: "variable-value" },
      results: FAILED_RUN.results.map((r) => ({ ...r, request: { ...(r.request as object), headers: { authorization: "Bearer request-header" }, body: "request-body" } })),
    })
    for (const report of [buildJUnitReport({ kind: "run", run, workflow: WORKFLOW }), buildHtmlReport({ kind: "run", run, workflow: WORKFLOW })]) {
      for (const value of ["sid=abc", "server-issued", "variable-value", "request-header", "request-body"]) {
        expect(report).not.toContain(value)
      }
    }
  })
})

describe("writeReport", () => {
  it("writes the chosen format to the given path", async () => {
    const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "apiweave-report-"))
    try {
      const file = path.join(dir, "junit.xml")
      await writeReport(file, "junit", { kind: "run", run: FAILED_RUN, workflow: WORKFLOW })
      expect(parseXml(await fs.promises.readFile(file, "utf8")).name).toBe("testsuites")
      await writeReport(file, "html", { kind: "run", run: FAILED_RUN, workflow: WORKFLOW })
      expect(await fs.promises.readFile(file, "utf8")).toMatch(/^<!DOCTYPE html>/)
    } finally {
      await fs.promises.rm(dir, { recursive: true, force: true })
    }
  })
})
