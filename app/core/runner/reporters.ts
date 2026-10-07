import fs from "node:fs"
import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation"
import type { ProjectRun } from "@shared/types/ProjectRun"
import type { ReportFormat } from "@shared/types/ReportFormat"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { Workflow } from "@shared/types/Workflow"

/**
 * JUnit XML and HTML reports of a finished workflow run or project run.
 *
 * Plain Node with no Electron import, so the desktop app and a headless runner
 * build the same report. Input is always the PERSISTED run, as a repository or
 * `runs.get` returns it: secret values are masked and error text reduced to
 * safe classes before a run is stored, and a report never sees anything else.
 * It goes further than run history on purpose, because a report is a file that
 * leaves the app: it carries no request or response headers or bodies and no
 * variables — only names, statuses, timings, request method and URL (already
 * stripped of its query), response status codes and assertion rules.
 *
 * Mapping: one `<testsuite>` per workflow run (a single run gives one, a
 * project run one per workflow in run order) and one `<testcase>` per executed
 * node, Start and End excluded. An assertion node is one test case; its failed
 * rules are listed in the failure text. A run that failed, was cancelled or was
 * interrupted with no failed node gets a `Run` test case that fails, so CI never
 * reads it as green. A project workflow that never ran is one skipped test case.
 */

/** The workflow's name and nodes, for test case names. `Workflow` satisfies it. */
export type ReportWorkflow = Pick<Workflow, "workflowId" | "name" | "nodes">

export type ReportInput =
  | {
      readonly kind: "run"
      readonly run: Run
      /** Null when the workflow has since been deleted: cases are then named by node id. */
      readonly workflow: ReportWorkflow | null
    }
  | {
      readonly kind: "project"
      readonly projectName: string
      readonly projectRun: ProjectRun
      /** The runs its items name; an item whose run is missing is reported as not run. */
      readonly runs: readonly Run[]
      readonly workflows: readonly ReportWorkflow[]
    }

type Outcome = "passed" | "failed" | "skipped"

interface ReportCase {
  readonly name: string
  readonly type: string
  readonly outcome: Outcome
  readonly durationMs: number
  /** One line: the failure or skip message. */
  readonly message: string | null
  /** Further lines: failed assertion rules, request line, status code. */
  readonly details: readonly string[]
}

interface ReportSuite {
  readonly name: string
  readonly runId: string | null
  readonly status: string
  readonly startedAt: string | null
  readonly durationMs: number
  readonly cases: readonly ReportCase[]
}

interface Report {
  readonly title: string
  readonly status: string
  readonly startedAt: string | null
  readonly suites: readonly ReportSuite[]
}

const NOT_TEST_NODES: ReadonlySet<string> = new Set(["start", "end", "group", "note"])

// -------------------- Model --------------------

function toReport(input: ReportInput): Report {
  if (input.kind === "run") {
    const name = input.workflow?.name ?? input.run.workflowId
    return {
      title: name,
      status: input.run.status,
      startedAt: input.run.startedAt ?? null,
      suites: [runSuite(name, input.run, input.workflow)],
    }
  }
  const runs = new Map(input.runs.map((run) => [run.runId, run]))
  const workflows = new Map(input.workflows.map((workflow) => [workflow.workflowId, workflow]))
  return {
    title: input.projectName,
    status: input.projectRun.status,
    startedAt: input.projectRun.startedAt,
    suites: input.projectRun.items.map((item) => {
      const run = item.runId === null ? undefined : runs.get(item.runId)
      if (run !== undefined) return runSuite(item.workflowName, run, workflows.get(item.workflowId) ?? null)
      const reason =
        item.runId !== null
          ? "Its run was deleted from history"
          : item.status === "skipped"
            ? "Not run: the project run stopped before this workflow"
            : "Not run yet"
      return {
        name: item.workflowName,
        runId: item.runId,
        status: item.status,
        startedAt: null,
        durationMs: 0,
        cases: [{ name: item.workflowName, type: "workflow", outcome: "skipped", durationMs: 0, message: reason, details: [] }],
      }
    }),
  }
}

function runSuite(name: string, run: Run, workflow: ReportWorkflow | null): ReportSuite {
  const nodes = new Map((workflow?.nodes ?? []).map((node) => [node.nodeId, node]))
  const results = new Map(run.results.map((result) => [result.nodeId, result]))
  // Recorded statuses are in the order nodes ran; a result without one still counts.
  const nodeIds = [...new Set([...Object.keys(run.nodeStatuses), ...results.keys()])]
  const cases: ReportCase[] = []
  for (const nodeId of nodeIds) {
    const node = nodes.get(nodeId)
    const type = node?.type ?? "node"
    if (NOT_TEST_NODES.has(type)) continue
    const result = results.get(nodeId)
    const entry = run.nodeStatuses[nodeId]
    const recorded = statusOf(entry) ?? result?.status ?? "idle"
    const outcome: Outcome = recorded === "passed" || recorded === "failed" ? recorded : "skipped"
    cases.push({
      name: node?.label || nodeId,
      type,
      outcome,
      durationMs: result?.duration ?? 0,
      message:
        outcome === "failed"
          ? failureMessage(result, entry)
          : outcome === "skipped" && recorded !== "skipped"
            ? `Did not finish (${recorded})`
            : null,
      details: details(result, outcome),
    })
  }
  if (run.status !== "completed" && !cases.some((testCase) => testCase.outcome === "failed")) {
    const live = run.status === "pending" || run.status === "running"
    cases.push({
      name: "Run",
      type: "run",
      outcome: live ? "skipped" : "failed",
      durationMs: run.duration ?? 0,
      message: run.failureMessage ?? run.error ?? `Run ${run.status}`,
      details: [],
    })
  }
  return {
    name,
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt ?? null,
    durationMs: run.duration ?? 0,
    cases,
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)[key]
    : undefined
}

/** A node-status entry is `{ status, message?, ... }`; older rows stored the bare status. */
function statusOf(entry: unknown): string | undefined {
  if (typeof entry === "string") return entry
  const status = field(entry, "status")
  return typeof status === "string" ? status : undefined
}

function statusCodeOf(result: RunResult | undefined): number | undefined {
  const code = field(result?.response, "statusCode")
  return typeof code === "number" ? code : undefined
}

function failureMessage(result: RunResult | undefined, entry: unknown): string {
  const failedRules = (result?.assertions ?? []).filter((rule) => rule.outcome === "fail").length
  if (failedRules > 0) {
    return `${failedRules} of ${result?.assertions?.length ?? 0} assertion rules failed`
  }
  const code = statusCodeOf(result)
  const expected = result?.expectedStatus === undefined ? [] : [result.expectedStatus].flat()
  if (code !== undefined && expected.length > 0 && !expected.includes(code)) {
    return `Status ${code}, expected ${expected.join(" or ")}`
  }
  if (typeof result?.error === "string" && result.error !== "") return result.error
  const message = field(entry, "message")
  return typeof message === "string" && message !== "" ? message : "Node failed"
}

function describeRule(rule: AssertionEvaluation): string {
  const subject = rule.path === "" ? rule.source : `${rule.source} ${rule.path}`
  return `Rule ${rule.ruleIndex + 1}: ${subject} ${rule.operator} — ${rule.outcome} (${rule.reasonCode})`
}

function details(result: RunResult | undefined, outcome: Outcome): string[] {
  if (result === undefined) return []
  const lines: string[] = []
  const method = field(result.request, "method")
  const url = field(result.request, "url")
  if (typeof url === "string") lines.push(typeof method === "string" ? `${method} ${url}` : url)
  const code = statusCodeOf(result)
  if (code !== undefined) lines.push(`Status ${code}`)
  for (const rule of result.assertions ?? []) {
    if (outcome !== "failed" || rule.outcome === "fail") lines.push(describeRule(rule))
  }
  return lines
}

function counts(cases: readonly ReportCase[]): { tests: number; failures: number; skipped: number } {
  return {
    tests: cases.length,
    failures: cases.filter((testCase) => testCase.outcome === "failed").length,
    skipped: cases.filter((testCase) => testCase.outcome === "skipped").length,
  }
}

// -------------------- Escaping --------------------

/** Characters XML 1.0 cannot carry at all, escaped or not. */
const XML_INVALID = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g

function escapeXmlText(value: string): string {
  return value
    .replace(XML_INVALID, "�")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
}

function escapeXmlAttr(value: string): string {
  return escapeXmlText(value)
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;")
    .replace(/\n/g, "&#10;")
    .replace(/\r/g, "&#13;")
    .replace(/\t/g, "&#9;")
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
}

function seconds(ms: number): string {
  return (Math.max(0, ms) / 1000).toFixed(3)
}

// -------------------- JUnit XML --------------------

function attrs(values: Readonly<Record<string, string | number | null>>): string {
  return Object.entries(values)
    .filter((entry): entry is [string, string | number] => entry[1] !== null)
    .map(([key, value]) => ` ${key}="${escapeXmlAttr(String(value))}"`)
    .join("")
}

function junitCase(suite: ReportSuite, testCase: ReportCase): string {
  const head = `    <testcase${attrs({ classname: suite.name, name: testCase.name, time: seconds(testCase.durationMs) })}`
  const text = [testCase.message ?? "", ...testCase.details].filter((line) => line !== "").join("\n")
  if (testCase.outcome === "failed") {
    const type = testCase.type === "assertion" ? "AssertionError" : "NodeFailure"
    return `${head}>\n      <failure${attrs({ message: testCase.message, type })}>${escapeXmlText(text)}</failure>\n    </testcase>`
  }
  if (testCase.outcome === "skipped") {
    return `${head}>\n      <skipped${attrs({ message: testCase.message })}/>\n    </testcase>`
  }
  return `${head}/>`
}

/** JUnit XML: `<testsuites>` → one `<testsuite>` per workflow run → `<testcase>` per node. */
export function buildJUnitReport(input: ReportInput): string {
  const report = toReport(input)
  const all = counts(report.suites.flatMap((suite) => suite.cases))
  const totalMs = report.suites.reduce((sum, suite) => sum + suite.durationMs, 0)
  const suites = report.suites.map((suite, index) => {
    const { tests, failures, skipped } = counts(suite.cases)
    const open = `  <testsuite${attrs({
      name: suite.name,
      id: index,
      tests,
      failures,
      errors: 0,
      skipped,
      time: seconds(suite.durationMs),
      timestamp: suite.startedAt,
    })}`
    if (suite.cases.length === 0) return `${open}/>`
    return `${open}>\n${suite.cases.map((testCase) => junitCase(suite, testCase)).join("\n")}\n  </testsuite>`
  })
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<testsuites${attrs({ name: report.title, tests: all.tests, failures: all.failures, errors: 0, skipped: all.skipped, time: seconds(totalMs) })}>`,
    ...suites,
    `</testsuites>`,
    "",
  ].join("\n")
}

// -------------------- HTML --------------------

const OUTCOME_LABEL: Record<Outcome, string> = { passed: "Passed", failed: "Failed", skipped: "Skipped" }

function htmlSuite(suite: ReportSuite): string {
  const { tests, failures, skipped } = counts(suite.cases)
  const rows = suite.cases
    .map(
      (testCase) => `        <tr class="${testCase.outcome}">
          <td>${escapeHtml(testCase.name)}<div class="type">${escapeHtml(testCase.type)}</div></td>
          <td><span class="badge ${testCase.outcome}">${OUTCOME_LABEL[testCase.outcome]}</span></td>
          <td class="num">${seconds(testCase.durationMs)}s</td>
          <td>${testCase.message === null ? "" : `<div class="message">${escapeHtml(testCase.message)}</div>`}${testCase.details
            .map((line) => `<div class="detail">${escapeHtml(line)}</div>`)
            .join("")}</td>
        </tr>`,
    )
    .join("\n")
  return `  <section>
    <h2>${escapeHtml(suite.name)} <span class="status">${escapeHtml(suite.status)}</span></h2>
    <p class="meta">${tests - failures - skipped} passed · ${failures} failed · ${skipped} skipped · ${seconds(suite.durationMs)}s${
      suite.startedAt === null ? "" : ` · started ${escapeHtml(suite.startedAt)}`
    }${suite.runId === null ? "" : ` · run ${escapeHtml(suite.runId)}`}</p>
    <table>
      <thead><tr><th>Step</th><th>Result</th><th class="num">Time</th><th>Details</th></tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`
}

/** A single self-contained HTML page: inline CSS, no script, no external asset. */
export function buildHtmlReport(input: ReportInput): string {
  const report = toReport(input)
  const all = counts(report.suites.flatMap((suite) => suite.cases))
  const title = `${report.title} — APIWeave run report`
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  :root { --bg: #f6f6f8; --fg: #1d1d1f; --muted: #6e6e73; --card: #fff; --line: #e5e5ea; --pass: #1f7a3f; --fail: #b42318; --skip: #8a5a00; }
  @media (prefers-color-scheme: dark) { :root { --bg: #17171a; --fg: #f2f2f5; --muted: #a1a1a6; --card: #222226; --line: #33333a; --pass: #4ade80; --fail: #f87171; --skip: #fbbf24; } }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 24px 16px; background: var(--bg); color: var(--fg); font: 14px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
  main { max-width: 1100px; margin: 0 auto; }
  h1 { font-size: 1.4rem; margin: 0 0 4px; }
  h2 { font-size: 1.05rem; margin: 0 0 4px; }
  .meta, .type { color: var(--muted); font-size: 0.8rem; }
  .status { color: var(--muted); font-weight: 400; font-size: 0.85rem; }
  .totals { display: flex; gap: 24px; margin: 16px 0 24px; }
  .totals b { display: block; font-size: 1.5rem; }
  section { background: var(--card); border: 1px solid var(--line); border-radius: 10px; padding: 16px; margin-bottom: 16px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; margin-top: 8px; }
  th, td { text-align: left; vertical-align: top; padding: 6px 8px; border-top: 1px solid var(--line); }
  th { color: var(--muted); font-weight: 500; font-size: 0.8rem; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .badge { font-size: 0.75rem; font-weight: 600; }
  .badge.passed { color: var(--pass); } .badge.failed { color: var(--fail); } .badge.skipped { color: var(--skip); }
  .message { color: var(--fail); } tr.skipped .message { color: var(--skip); }
  .detail { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.78rem; color: var(--muted); word-break: break-all; }
</style>
</head>
<body>
<main>
  <h1>${escapeHtml(report.title)}</h1>
  <p class="meta">${escapeHtml(report.status)}${report.startedAt === null ? "" : ` · started ${escapeHtml(report.startedAt)}`}</p>
  <div class="totals">
    <div><b>${all.tests - all.failures - all.skipped}</b>passed</div>
    <div><b>${all.failures}</b>failed</div>
    <div><b>${all.skipped}</b>skipped</div>
  </div>
${report.suites.map(htmlSuite).join("\n")}
</main>
</body>
</html>
`
}

// -------------------- Console --------------------

const ANSI = { green: "\u001b[32m", red: "\u001b[31m", yellow: "\u001b[33m", dim: "\u001b[2m", bold: "\u001b[1m", reset: "\u001b[0m" }
const CONSOLE_MARK: Record<Outcome, { mark: string; color: string }> = {
  passed: { mark: "✔", color: ANSI.green },
  failed: { mark: "✖", color: ANSI.red },
  skipped: { mark: "○", color: ANSI.yellow },
}

/**
 * Plain text for a terminal or a CI log: one block per workflow run with a
 * line per step, failure messages and details under failed steps, then a
 * summary table. `color` adds ANSI colours; leave it off for NO_COLOR or a
 * non-TTY stream.
 */
export function buildConsoleReport(input: ReportInput, color: boolean): string {
  const paint = (style: string, text: string): string => (color ? `${style}${text}${ANSI.reset}` : text)
  const report = toReport(input)
  const lines: string[] = [paint(ANSI.bold, report.title) + paint(ANSI.dim, ` · ${report.status}`), ""]
  for (const suite of report.suites) {
    const suiteOutcome: Outcome = suite.status === "completed" ? "passed" : suite.runId === null ? "skipped" : "failed"
    lines.push(
      `${paint(CONSOLE_MARK[suiteOutcome].color, suite.name)}${paint(ANSI.dim, ` · ${suite.status} · ${seconds(suite.durationMs)}s`)}`,
    )
    const width = Math.max(0, ...suite.cases.map((testCase) => testCase.name.length))
    for (const testCase of suite.cases) {
      const { mark, color: tint } = CONSOLE_MARK[testCase.outcome]
      lines.push(`  ${paint(tint, mark)} ${testCase.name.padEnd(width)}  ${paint(ANSI.dim, `${seconds(testCase.durationMs)}s`)}`)
      if (testCase.outcome === "passed") continue
      if (testCase.message !== null) lines.push(`      ${paint(tint, testCase.message)}`)
      if (testCase.outcome === "failed") for (const line of testCase.details) lines.push(`      ${paint(ANSI.dim, line)}`)
    }
    lines.push("")
  }
  const cases = counts(report.suites.flatMap((suite) => suite.cases))
  const passedSuites = report.suites.filter((suite) => suite.status === "completed").length
  const skippedSuites = report.suites.filter((suite) => suite.runId === null).length
  const rows: (string | number)[][] = [
    ["", "total", "passed", "failed", "skipped"],
    ["Workflows", report.suites.length, passedSuites, report.suites.length - passedSuites - skippedSuites, skippedSuites],
    ["Steps", cases.tests, cases.tests - cases.failures - cases.skipped, cases.failures, cases.skipped],
  ]
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)))
  for (const row of rows) {
    lines.push(row.map((cell, column) => (column === 0 ? String(cell).padEnd(widths[column]!) : String(cell).padStart(widths[column]!))).join("  "))
  }
  lines.push(`Duration ${seconds(report.suites.reduce((sum, suite) => sum + suite.durationMs, 0))}s`, "")
  return lines.join("\n")
}

// -------------------- Entry points --------------------

export function buildReport(format: ReportFormat, input: ReportInput): string {
  return format === "junit" ? buildJUnitReport(input) : buildHtmlReport(input)
}

/** Builds the report and writes it to `filePath`, replacing any file there. */
export async function writeReport(filePath: string, format: ReportFormat, input: ReportInput): Promise<void> {
  await fs.promises.writeFile(filePath, buildReport(format, input), "utf8")
}
