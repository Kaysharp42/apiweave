import fs from "node:fs"
import type { AssertionEvaluation } from "@shared/types/AssertionEvaluation"
import type { ProjectRun } from "@shared/types/ProjectRun"
import type { ReportFormat } from "@shared/types/ReportFormat"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { ScriptOutcome } from "@shared/types/ScriptOutcome"
import type { Workflow } from "@shared/types/Workflow"
import type { LoadRun } from "@shared/types/LoadRun"

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
 * stripped of its query), response status codes and assertion rules, plus a
 * script's test results and the console output its author chose to print, and
 * a failed browser step's compared values and page URL (also without its
 * query). A page's own content — its screenshot and ARIA snapshot — is only
 * ever linked, as files the caller wrote beside the report.
 *
 * Mapping: one `<testsuite>` per workflow run (a single run gives one, a
 * project run one per workflow in run order) and one `<testcase>` per executed
 * node, Start and End excluded. An assertion node is one test case; its failed
 * rules are listed in the failure text. A run that failed, was cancelled or was
 * interrupted with no failed node gets a `Run` test case that fails, so CI never
 * reads it as green. A project workflow whose run is not stored is one test
 * case: failed when its item failed, was cancelled or interrupted, else skipped.
 * A data-driven run is its iterations' suites in order, each suite name
 * suffixed ` [iteration N]`. A repository run is its projects' suites in order,
 * each suite name prefixed `<project>: `, however many projects ran.
 */

/** The workflow's name and nodes, for test case names. `Workflow` satisfies it. */
export type ReportWorkflow = Pick<Workflow, "workflowId" | "name" | "nodes">

/**
 * A browser step's evidence, written next to the report (`apiweave run
 * --evidence-dir`): each path as this report should name it — relative to the
 * HTML file for HTML, to the working directory otherwise. The report links
 * the files and never holds their content.
 */
export interface ReportEvidence {
  readonly screenshot?: string
  readonly ariaSnapshot?: string
  /** The called workflow and step the files belong to (`Login › Check heading`); absent for the case's own step. */
  readonly step?: string
}

/**
 * The evidence written for one node of one run, if any: one entry per
 * browser step. A browser node has at most its own; a Call Workflow node has
 * one per step of every workflow it reached, iterations included.
 */
export type ReportEvidenceLookup = (runId: string, nodeId: string) => readonly ReportEvidence[] | undefined

export type ReportInput =
  | SingleReportInput
  | {
      readonly kind: "iterations"
      readonly title: string
      /** One input per iteration that ran, in order. */
      readonly iterations: readonly SingleReportInput[]
    }
  | {
      readonly kind: "projects"
      /** The workspace's name: what a repository run is called. */
      readonly title: string
      /** One input per project that ran, in run order. */
      readonly projects: readonly SingleReportInput[]
    }
  | {
      readonly kind: "load"
      readonly title: string
      readonly loadRun: LoadRun
    }

/** One workflow run or one project run. */
export type SingleReportInput =
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
      /** The runs its items name; an item whose run is missing is reported from its own status. */
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
  /** Further lines: failed assertion rules, request line, status code, attempts. */
  readonly details: readonly string[]
  /** Requests a retrying node sent; null when it has no retry. */
  readonly attempts: number | null
  /** What the node's scripts printed with console.log, in order. */
  readonly logs: readonly string[]
  /** Contract violations recorded on a node that still passed (contract mode `warn`). */
  readonly warnings: readonly string[]
  /** Browser steps' evidence files, when they were written. */
  readonly evidence?: readonly ReportEvidence[]
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
  /** One status per iteration of a data-driven run, or per project of a repository run, under the label the summary gives that row. */
  readonly rollup?: { readonly label: "Iterations" | "Projects"; readonly statuses: readonly string[] }
  /** The load run a `kind: "load"` input describes; drives the latency table. */
  readonly load?: LoadRun
}

const NOT_TEST_NODES: ReadonlySet<string> = new Set(["start", "end", "group", "note"])

// -------------------- Model --------------------

const NO_EVIDENCE: ReportEvidenceLookup = () => undefined

function toReport(input: ReportInput, evidence: ReportEvidenceLookup = NO_EVIDENCE): Report {
  if (input.kind === "iterations") {
    return combine(input.title, input.iterations.map((one) => toReport(one, evidence)), "Iterations", (_report, suite, index) => `${suite.name} [iteration ${index + 1}]`)
  }
  if (input.kind === "load") {
    return {
      title: input.title,
      status: input.loadRun.status,
      startedAt: input.loadRun.startedAt,
      suites: [loadSuite(input.loadRun)],
      load: input.loadRun,
    }
  }
  if (input.kind === "projects") {
    // Two projects can both hold a "Login", so the project's name always leads: a suite is named the same
    // whether or not other projects ran (--bail and skipped projects change how many did).
    return combine(input.title, input.projects.map((one) => toReport(one, evidence)), "Projects", (report, suite) => `${report.title}: ${suite.name}`)
  }
  if (input.kind === "run") {
    const name = input.workflow?.name ?? input.run.workflowId
    return {
      title: name,
      status: input.run.status,
      startedAt: input.run.startedAt ?? null,
      suites: [runSuite(name, input.run, input.workflow, evidence)],
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
      if (run !== undefined) return runSuite(item.workflowName, run, workflows.get(item.workflowId) ?? null, evidence)
      // The item's own status still says how it ended, even with its run gone.
      const failed = item.status === "failed" || item.status === "cancelled" || item.status === "interrupted"
      const reason = failed
        ? `Workflow ${item.status}; its run record is unavailable`
        : item.runId !== null
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
        cases: [{ name: item.workflowName, type: "workflow", outcome: failed ? "failed" : "skipped", durationMs: 0, message: reason, details: [], attempts: null, logs: [], warnings: [] }],
      }
    }),
  }
}

/** One report out of several: the first that did not complete sets the status, and each suite is named by `suiteName`. */
function combine(
  title: string,
  reports: readonly Report[],
  label: "Iterations" | "Projects",
  suiteName: (report: Report, suite: ReportSuite, index: number) => string,
): Report {
  return {
    title,
    status: reports.find((report) => report.status !== "completed")?.status ?? "completed",
    startedAt: reports[0]?.startedAt ?? null,
    suites: reports.flatMap((report, index) => report.suites.map((suite) => ({ ...suite, name: suiteName(report, suite, index) }))),
    rollup: { label, statuses: reports.map((report) => report.status) },
  }
}

function runSuite(name: string, run: Run, workflow: ReportWorkflow | null, evidence: ReportEvidenceLookup): ReportSuite {
  const nodes = new Map((workflow?.nodes ?? []).map((node) => [node.nodeId, node]))
  const results = new Map(run.results.map((result) => [result.nodeId, result]))
  // Recorded statuses are in the order nodes ran; a result without one still counts.
  const nodeIds = [...new Set([...Object.keys(run.nodeStatuses), ...results.keys()])]
  const cases: ReportCase[] = []
  for (const nodeId of nodeIds) {
    const node = nodes.get(nodeId)
    const type = node?.type ?? "node"
    if (NOT_TEST_NODES.has(type)) continue
    cases.push(nodeCase(node?.label || nodeId, type, results.get(nodeId), run.nodeStatuses[nodeId], evidence(run.runId, nodeId)))
  }
  if (run.status !== "completed" && !cases.some((testCase) => testCase.outcome === "failed")) cases.push(runCase(run))
  return {
    name,
    runId: run.runId,
    status: run.status,
    startedAt: run.startedAt ?? null,
    durationMs: run.duration ?? 0,
    cases,
  }
}

/** A load run's one suite: a case per node plus a Thresholds case, so JUnit and the console stay CI-usable. */
function loadSuite(loadRun: LoadRun): ReportSuite {
  const cases: ReportCase[] = loadRun.nodeStats.map((stats) => {
    const failed = stats.errorCount > 0
    return {
      name: stats.label || stats.nodeId,
      type: stats.type,
      outcome: failed ? "failed" : "passed",
      durationMs: stats.latency.meanMs ?? 0,
      message: failed ? `${stats.errorCount} of ${stats.count} iterations failed (${percent(stats.errorRate)})` : null,
      details: [],
      attempts: null,
      logs: [],
      warnings: [],
    }
  })
  if (loadRun.settings.thresholds.length > 0) {
    cases.push({
      name: "Thresholds",
      type: "thresholds",
      outcome: loadRun.breachedThresholds.length > 0 ? "failed" : "passed",
      durationMs: 0,
      message: loadRun.breachedThresholds.length > 0 ? `${loadRun.breachedThresholds.length} threshold(s) breached` : null,
      details: loadRun.breachedThresholds,
      attempts: null,
      logs: [],
      warnings: [],
    })
  }
  return {
    name: "Load run",
    runId: null,
    status: loadRun.status,
    startedAt: loadRun.startedAt,
    durationMs: loadRun.durationMs ?? 0,
    cases,
  }
}

/** `0.125` → `12.5%`. */
function percent(rate: number): string {
  return `${(rate * 100).toFixed(1).replace(/\.0$/, "")}%`
}

function msOrDash(value: number | null): string {
  return value === null ? "—" : String(value)
}

/** The latency table's column order and widths. */
const LOAD_COLUMNS = ["Node", "Count", "Errors", "Error rate", "Min", "Mean", "p50", "p90", "p95", "p99", "Max", "Throughput"] as const

/** One `<section>` holding the load run's latency table, plus its settings and threshold outcome. */
function htmlLoadSection(loadRun: LoadRun): string {
  const settings = loadRun.settings
  const rows = loadRun.nodeStats
    .map(
      (stats) => `        <tr>
          <td>${escapeHtml(stats.label || stats.nodeId)}<div class="type">${escapeHtml(stats.type)}</div></td>
          <td class="num">${stats.count}</td>
          <td class="num">${stats.errorCount}</td>
          <td class="num">${percent(stats.errorRate)}</td>
          <td class="num">${msOrDash(stats.latency.minMs)}</td>
          <td class="num">${msOrDash(stats.latency.meanMs)}</td>
          <td class="num">${msOrDash(stats.latency.p50Ms)}</td>
          <td class="num">${msOrDash(stats.latency.p90Ms)}</td>
          <td class="num">${msOrDash(stats.latency.p95Ms)}</td>
          <td class="num">${msOrDash(stats.latency.p99Ms)}</td>
          <td class="num">${msOrDash(stats.latency.maxMs)}</td>
          <td class="num">${stats.throughput.toFixed(2)}/s</td>
        </tr>`,
    )
    .join("\n")
  const settingsText = [
    `${loadRun.iterationCount} iterations`,
    `concurrency ${settings.concurrency}`,
    ...(settings.durationMs === null ? [] : [`duration ${seconds(settings.durationMs)}s`]),
    ...(settings.rampUpMs === null ? [] : [`ramp-up ${seconds(settings.rampUpMs)}s`]),
  ].join(" · ")
  const thresholds =
    settings.thresholds.length === 0
      ? ""
      : `<p class="meta">Thresholds: ${loadRun.breachedThresholds.length === 0 ? "all passed" : `${loadRun.breachedThresholds.length} breached`}</p>` +
        loadRun.breachedThresholds.map((breach) => `<div class="message">${escapeHtml(breach)}</div>`).join("")
  return `  <section>
    <h2>Latency <span class="status">${settingsText}</span></h2>
    ${thresholds}
    <table>
      <thead><tr>${LOAD_COLUMNS.map((column) => `<th class="num">${column}</th>`).join("")}</tr></thead>
      <tbody>
${rows}
      </tbody>
    </table>
  </section>`
}

/** The load run's latency table as plain text for the console. */
function consoleLoadTable(loadRun: LoadRun): string[] {
  const header = LOAD_COLUMNS.map((column) => column)
  const rows: (string | number)[][] = [
    header,
    ...loadRun.nodeStats.map((stats) => [
      stats.label || stats.nodeId,
      stats.count,
      stats.errorCount,
      percent(stats.errorRate),
      msOrDash(stats.latency.minMs),
      msOrDash(stats.latency.meanMs),
      msOrDash(stats.latency.p50Ms),
      msOrDash(stats.latency.p90Ms),
      msOrDash(stats.latency.p95Ms),
      msOrDash(stats.latency.p99Ms),
      msOrDash(stats.latency.maxMs),
      `${stats.throughput.toFixed(2)}/s`,
    ]),
  ]
  const widths = header.map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)))
  return rows.map((row) => row.map((cell, column) => (column === 0 ? String(cell).padEnd(widths[column]!) : String(cell).padStart(widths[column]!))).join("  "))
}

function nodeCase(name: string, type: string, result: RunResult | undefined, entry: unknown, evidence: readonly ReportEvidence[] | undefined): ReportCase {
  const recorded = statusOf(entry) ?? result?.status ?? "idle"
  const outcome: Outcome = recorded === "passed" || recorded === "failed" ? recorded : "skipped"
  return {
    name,
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
    attempts: result?.attempts?.length ?? null,
    logs: (result?.scripts ?? []).flatMap((script) => script.logs),
    warnings: outcome === "passed" ? (result?.assertions ?? []).filter((rule) => rule.outcome === "fail").flatMap(describeRule).map((line) => `Contract warning: ${line}`) : [],
    ...evidenceOf(evidence),
  }
}

/** Evidence files belong to their step, whether it passed or failed. */
function evidenceOf(evidence: readonly ReportEvidence[] | undefined): { evidence?: readonly ReportEvidence[] } {
  return evidence !== undefined && evidence.length > 0 ? { evidence } : {}
}

/** Stands in for a run that did not complete with no failed node to show for it. */
function runCase(run: Run): ReportCase {
  const live = run.status === "pending" || run.status === "running"
  return {
    name: "Run",
    type: "run",
    outcome: live ? "skipped" : "failed",
    durationMs: run.duration ?? 0,
    message: run.failureMessage ?? run.error ?? `Run ${run.status}`,
    details: [],
    attempts: null,
    logs: [],
    warnings: [],
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
  // An http-request node that failed its responseSchemas says so in its error.
  if (failedRules > 0 && !result?.error) {
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

/** The rule, then why it could not be compared or each schema violation, indented under it. */
function describeRule(rule: AssertionEvaluation): string[] {
  const subject = rule.path === "" ? rule.source : `${rule.source} ${rule.path}`
  return [
    `Rule ${rule.ruleIndex + 1}: ${subject} ${rule.operator} — ${rule.outcome} (${rule.reasonCode}${rule.detail ? `: ${rule.detail}` : ""})`,
    ...(rule.schemaErrors ?? []).map((violation) => `  ${violation.path === "" ? "(root)" : violation.path}: ${violation.message}`),
  ]
}

function details(result: RunResult | undefined, outcome: Outcome): string[] {
  if (result === undefined) return []
  return [
    ...requestLines(result),
    ...(outcome === "failed" ? browserLines(result) : []),
    ...(result.assertions ?? []).filter((rule) => outcome !== "failed" || rule.outcome === "fail").flatMap((rule) => describeRule(rule)),
    ...(result.scripts ?? []).flatMap((script) => scriptLines(script, result.error ?? "", outcome)),
  ]
}

/** The request line, the response status code, and each attempt a retrying node made. */
function requestLines(result: RunResult): string[] {
  const lines: string[] = []
  const method = field(result.request, "method")
  const url = field(result.request, "url")
  if (typeof url === "string") lines.push(typeof method === "string" ? `${method} ${url}` : url)
  const code = statusCodeOf(result)
  if (code !== undefined) lines.push(`Status ${code}`)
  if (result.attempts !== undefined) {
    lines.push(`Attempts ${result.attempts.length}: ${result.attempts.map((attempt) => attempt.statusCode ?? "no response").join(", ")}`)
  }
  return lines
}

/**
 * A failed browser step's compared values and the page it was on: what an
 * assertion rule's lines say for a response. Masked like the rest of the run;
 * the page's own content (ARIA snapshot, screenshot) is never inlined.
 */
function browserLines(result: RunResult): string[] {
  const browser = result.browser
  if (browser === undefined) return []
  return [
    ...(browser.expected === undefined ? [] : [`Expected: ${JSON.stringify(browser.expected)}`]),
    ...(browser.actual === undefined ? [] : [`Found: ${JSON.stringify(browser.actual)}`]),
    ...(browser.url === undefined ? [] : [`Page: ${browser.url}`]),
    ...(browser.evidenceNote === undefined ? [] : [browser.evidenceNote]),
  ]
}

function scriptLines(script: ScriptOutcome, nodeError: string, outcome: Outcome): string[] {
  const lines: string[] = []
  const label = script.phase === "preRequest" ? "Pre-request" : "Post-response"
  // The node's own error already says it when the script is why the node failed.
  if (script.error !== undefined && !nodeError.includes(script.error)) lines.push(`${label} script error: ${script.error}`)
  for (const test of script.tests) {
    if (outcome !== "failed" || !test.passed) {
      lines.push(`Test ${JSON.stringify(test.name)}: ${test.passed ? "passed" : `failed — ${test.error ?? ""}`}`)
    }
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

interface EvidenceFile {
  readonly label: string
  readonly path: string
  readonly screenshot: boolean
}

/** A case's evidence files in entry order, each named for the step it belongs to. */
function evidenceFiles(evidence: readonly ReportEvidence[] | undefined): EvidenceFile[] {
  return (evidence ?? []).flatMap((one) => {
    const suffix = one.step === undefined ? "" : ` (${one.step})`
    return [
      ...(one.screenshot === undefined ? [] : [{ label: `Screenshot${suffix}`, path: one.screenshot, screenshot: true }]),
      ...(one.ariaSnapshot === undefined ? [] : [{ label: `ARIA snapshot${suffix}`, path: one.ariaSnapshot, screenshot: false }]),
    ]
  })
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
  const children: string[] = []
  if (testCase.outcome === "failed") {
    const type = testCase.type === "assertion" ? "AssertionError" : "NodeFailure"
    children.push(`      <failure${attrs({ message: testCase.message, type })}>${escapeXmlText(text)}</failure>`)
  } else if (testCase.outcome === "skipped") {
    children.push(`      <skipped${attrs({ message: testCase.message })}/>`)
  }
  // The attachment convention GitLab and Jenkins read: a browser step's screenshot shows with the test.
  // GitLab shows only the first attachment, so every screenshot precedes every ARIA snapshot.
  const files = evidenceFiles(testCase.evidence)
  const attachments = [...files.filter((file) => file.screenshot), ...files.filter((file) => !file.screenshot)].map(
    (file) => `[[ATTACHMENT|${file.path}]]`,
  )
  const out = [...testCase.warnings, ...testCase.logs, ...attachments]
  if (out.length > 0) children.push(`      <system-out>${escapeXmlText(out.join("\n"))}</system-out>`)
  return children.length === 0 ? `${head}/>` : `${head}>\n${children.join("\n")}\n    </testcase>`
}

/** JUnit XML: `<testsuites>` → one `<testsuite>` per workflow run → `<testcase>` per node. */
export function buildJUnitReport(input: ReportInput, evidence?: ReportEvidenceLookup): string {
  const report = toReport(input, evidence)
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

/** Links to browser steps' files beside the report, and each screenshot shown from its file. */
function htmlEvidence(evidence: readonly ReportEvidence[] | undefined): string {
  const steps = evidence ?? []
  if (steps.length === 0) return ""
  const links = evidenceFiles(steps)
    .map((file) => `<a href="${htmlHref(file.path)}">${escapeHtml(file.label)}</a>`)
    .join(" · ")
  const images = steps.flatMap((one) =>
    one.screenshot === undefined
      ? []
      : [`<a href="${htmlHref(one.screenshot)}"><img class="shot" src="${htmlHref(one.screenshot)}" alt="The page after the step ran" loading="lazy"></a>`],
  )
  return `<div class="evidence">${links}</div>${images.join("")}`
}

/**
 * A report path as an href. A relative path is its segments, each encoded. An
 * absolute one — the evidence folder on another Windows drive, which
 * `path.relative` cannot make relative — becomes a `file:///` URL, because
 * encoding its `D:` segment would turn it into a path under the report.
 */
function htmlHref(file: string): string {
  const drive = /^[A-Za-z]:\//.test(file)
  if (!drive && !file.startsWith("/")) return file.split("/").map(encodeURIComponent).join("/")
  const segments = file.split("/").map((segment, index) => (drive && index === 0 ? segment : encodeURIComponent(segment)))
  return `file://${drive ? "/" : ""}${segments.join("/")}`
}

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
            .join("")}${testCase.logs.length === 0 ? "" : `<pre class="logs">${escapeHtml(testCase.logs.join("\n"))}</pre>`}${htmlEvidence(testCase.evidence)}</td>
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

/**
 * A single self-contained HTML page: inline CSS, no script, no external asset
 * other than the evidence files it links to, when `evidence` names any.
 */
export function buildHtmlReport(input: ReportInput, evidence?: ReportEvidenceLookup): string {
  const report = toReport(input, evidence)
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
  .logs { margin: 4px 0 0; white-space: pre-wrap; font-size: 0.78rem; color: var(--muted); }
  .detail { font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; font-size: 0.78rem; color: var(--muted); word-break: break-all; }
  .evidence { margin-top: 4px; font-size: 0.8rem; }
  .evidence a { color: inherit; }
  .shot { display: block; max-width: 480px; width: 100%; margin-top: 6px; border: 1px solid var(--line); border-radius: 6px; }
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
${report.load === undefined ? "" : htmlLoadSection(report.load)}
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

/** A project workflow that never ran: no run, and no failed case standing in for one. */
function notRun(suite: ReportSuite): boolean {
  return suite.runId === null && !suite.cases.some((testCase) => testCase.outcome === "failed")
}

/** One step's line, then under a step that did not pass why, under a failed one its details and logs, and under any step with files its evidence. */
function consoleCase(testCase: ReportCase, width: number, paint: (style: string, text: string) => string): string[] {
  const { mark, color: tint } = CONSOLE_MARK[testCase.outcome]
  const attempts = testCase.attempts === null ? "" : ` · ${testCase.attempts} attempt${testCase.attempts === 1 ? "" : "s"}`
  const lines = [`  ${paint(tint, mark)} ${testCase.name.padEnd(width)}  ${paint(ANSI.dim, `${seconds(testCase.durationMs)}s${attempts}`)}`]
  if (testCase.outcome === "passed")
    return [
      ...lines,
      ...testCase.warnings.map((line) => `      ${paint(ANSI.yellow, line)}`),
      ...evidenceFiles(testCase.evidence).map((file) => `      ${paint(ANSI.dim, `${file.label}: ${file.path}`)}`),
    ]
  if (testCase.message !== null) lines.push(`      ${paint(tint, testCase.message)}`)
  if (testCase.outcome === "skipped") return lines
  return [
    ...lines,
    ...testCase.details.map((line) => `      ${paint(ANSI.dim, line)}`),
    ...testCase.logs.map((line) => `      ${paint(ANSI.dim, `> ${line}`)}`),
    ...evidenceFiles(testCase.evidence).map((file) => `      ${paint(ANSI.dim, `${file.label}: ${file.path}`)}`),
  ]
}

/**
 * Plain text for a terminal or a CI log: one block per workflow run with a
 * line per step, failure messages and details under failed steps, then a
 * summary table. `color` adds ANSI colours; leave it off for NO_COLOR or a
 * non-TTY stream.
 */
export function buildConsoleReport(input: ReportInput, color: boolean, evidence?: ReportEvidenceLookup): string {
  const paint = (style: string, text: string): string => (color ? `${style}${text}${ANSI.reset}` : text)
  const report = toReport(input, evidence)
  const lines: string[] = [paint(ANSI.bold, report.title) + paint(ANSI.dim, ` · ${report.status}`), ""]
  for (const suite of report.suites) {
    const suiteOutcome: Outcome = suite.status === "completed" ? "passed" : notRun(suite) ? "skipped" : "failed"
    lines.push(
      `${paint(CONSOLE_MARK[suiteOutcome].color, suite.name)}${paint(ANSI.dim, ` · ${suite.status} · ${seconds(suite.durationMs)}s`)}`,
    )
    const width = Math.max(0, ...suite.cases.map((testCase) => testCase.name.length))
    for (const testCase of suite.cases) lines.push(...consoleCase(testCase, width, paint))
    lines.push("")
  }
  const cases = counts(report.suites.flatMap((suite) => suite.cases))
  const passedSuites = report.suites.filter((suite) => suite.status === "completed").length
  const skippedSuites = report.suites.filter(notRun).length
  const rows: (string | number)[][] = [
    ["", "total", "passed", "failed", "skipped"],
    ["Workflows", report.suites.length, passedSuites, report.suites.length - passedSuites - skippedSuites, skippedSuites],
    ["Steps", cases.tests, cases.tests - cases.failures - cases.skipped, cases.failures, cases.skipped],
  ]
  if (report.rollup !== undefined) {
    const { label, statuses } = report.rollup
    const passed = statuses.filter((status) => status === "completed").length
    rows.splice(1, 0, [label, statuses.length, passed, statuses.length - passed, 0])
  }
  const widths = rows[0]!.map((_, column) => Math.max(...rows.map((row) => String(row[column]).length)))
  for (const row of rows) {
    lines.push(row.map((cell, column) => (column === 0 ? String(cell).padEnd(widths[column]!) : String(cell).padStart(widths[column]!))).join("  "))
  }
  lines.push(`Duration ${seconds(report.suites.reduce((sum, suite) => sum + suite.durationMs, 0))}s`, "")
  if (report.load !== undefined) {
    lines.push("", "Latency", ...consoleLoadTable(report.load))
    if (report.load.breachedThresholds.length > 0) {
      lines.push("", `Thresholds breached: ${report.load.breachedThresholds.length}`)
      lines.push(...report.load.breachedThresholds.map((breach) => `  ${breach}`))
    }
  }
  return lines.join("\n")
}

// -------------------- Entry points --------------------

export function buildReport(format: ReportFormat, input: ReportInput, evidence?: ReportEvidenceLookup): string {
  return format === "junit" ? buildJUnitReport(input, evidence) : buildHtmlReport(input, evidence)
}

/** Builds the report and writes it to `filePath`, replacing any file there. */
export async function writeReport(filePath: string, format: ReportFormat, input: ReportInput): Promise<void> {
  await fs.promises.writeFile(filePath, buildReport(format, input), "utf8")
}
