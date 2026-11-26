import { RunSchema } from "@shared/zod-schemas"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import { BROWSER_STEP_PREFIX } from "../runner/browser/session"
import { AGENT_RUN_DENIED_ERROR } from "../runner/scheduler"
import { RUN_VARIABLES_BUDGET_BYTES, truncateUtf8Marked } from "../services/read_budgets"

/**
 * Bytes of a failed browser step's own error carried inline in a summary
 * entry. The runner's step diagnoses are short; the cap keeps a pathological
 * locator description from widening every summary row, with the marker saying
 * the error was cut.
 */
const FAILED_BROWSER_ERROR_BYTES = 512

/**
 * MCP run reads intentionally expose operational metadata only. The desktop UI
 * still receives full local run payloads over IPC, while agents cannot read
 * bodies, headers, cookies, URLs or assertion actual values through the
 * projected run tools. Two exceptions carry values, both bounded: the failed
 * node detail (a browser step's own error and page identity) and the
 * `runs_get` variables opt-in, which returns the run's stored final variables
 * — masked at capture, so a value the run resolved from a secret reads
 * `<SECRET>`. `runs.getNodeResult` returns bounded per-node evidence after the
 * shared secret-redaction pass; it does not go through this projection.
 *
 * Summaries aggregate: one row carries identity, status, timing, failure
 * counts and the workflow revision the run executed. It never carries the run
 * record's own write counter, which says nothing about the graph that ran, nor
 * any per-node results. A single read additionally
 * names every failed node with its expected status and unresolved
 * placeholders, so a matched negative test or a missing value is legible
 * without a second call. Per-node detail beyond that lives in the evidence
 * tool, in a single representation rather than duplicated nodeStatuses plus
 * results maps.
 */
export function projectRunToolResult(value: unknown, options: RunToolReadOptions = {}): unknown {
  if (value === null) return null

  const run = RunSchema.safeParse(value)
  if (run.success) return projectRunSummary(run.data, options)

  if (isRecord(value) && Array.isArray(value["items"])) {
    return {
      total: typeof value["total"] === "number" ? value["total"] : value["items"].length,
      items: value["items"].map((item) => {
        const parsed = RunSchema.safeParse(item)
        return parsed.success ? projectRunHistoryRow(parsed.data) : null
      }).filter((item) => item !== null),
    }
  }

  throw new Error("MCP run projection received an unexpected handler result")
}

/** MCP-only read options a run projection honours; none of them changes the shared IPC result. */
export interface RunToolReadOptions {
  /**
   * `runs_get`'s opt-in: also carry the run's stored variables as a bounded
   * {@link RunVariablesSection}. The shared handler returns the full local
   * Run either way — the renderer consumes `run.variables` directly — so this
   * is a projection choice the bridge makes from the tool payload.
   */
  readonly variables?: boolean
}

function projectRunSummary(run: Run, options: RunToolReadOptions): Record<string, JsonValue> {
  return {
    ...projectRunHistoryRow(run),
    statusCounts: projectStatusCounts(run.results),
    failedNodeDetails: run.results
      .filter((result) => result.status === "failed")
      .map((result) => projectFailedNode(result, run)),
    ...(options.variables === true ? { variables: projectRunVariables(run.variables, RUN_VARIABLES_BUDGET_BYTES) } : {}),
  }
}

/**
 * The `variables` section a `runs_get` opt-in returns: the run's stored
 * variables, bounded. A type alias rather than an interface so it satisfies
 * the projection's `JsonValue` record shape.
 */
export type RunVariablesSection = {
  /** The variables that fit, exactly as stored (masked), in stored order. */
  readonly values: Record<string, JsonValue>
  /** Names whose entries did not fit the budget — listed, never silently dropped. */
  readonly omittedVariableNames: string[]
  /** JSON-encoded bytes the carried entries occupy. */
  readonly budgetBytes: number
  /** The section's stated cap; `budgetBytes <= budgetLimitBytes` always holds. */
  readonly budgetLimitBytes: number
}

/**
 * Fit a run's stored variables into the inline budget. Entries are measured
 * as they serialize (quoted key, colon, JSON-encoded value, separating comma)
 * and kept whole or dropped with the name listed — the same never-silently-
 * sliced posture the evidence budgets hold — so an agent never mistakes a cut
 * value for the run's real variable. One oversized entry does not starve the
 * rest: it is dropped and the scan continues.
 */
export function projectRunVariables(
  variables: Readonly<Record<string, JsonValue>>,
  budgetLimitBytes: number,
): RunVariablesSection {
  const values: Record<string, JsonValue> = {}
  const omittedVariableNames: string[] = []
  let budgetBytes = 0
  for (const [name, value] of Object.entries(variables)) {
    const bytes = encodedJsonBytes(JSON.stringify(name)) + 1 + encodedJsonBytes(JSON.stringify(value) ?? "null") + (budgetBytes === 0 ? 0 : 1)
    if (budgetBytes + bytes > budgetLimitBytes) {
      omittedVariableNames.push(name)
      continue
    }
    values[name] = value
    budgetBytes += bytes
  }
  return { values, omittedVariableNames, budgetBytes, budgetLimitBytes }
}

/** UTF-8 bytes of an already JSON-encoded fragment, counted as the section serializes it. */
function encodedJsonBytes(text: string): number {
  return Buffer.byteLength(text, "utf8")
}

function projectRunHistoryRow(run: Run): Record<string, JsonValue> {
  const failedNodes = run.failedNodes ? [...run.failedNodes] : []
  return {
    runId: run.runId,
    workspaceId: run.workspaceId,
    workflowId: run.workflowId,
    selectedEnvironmentId: run.selectedEnvironmentId ?? null,
    status: run.status,
    terminal: TERMINAL_STATUSES.has(run.status),
    trigger: run.trigger,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    duration: run.duration ?? null,
    hasError: Boolean(run.error || run.failureMessage),
    // The one run-level outcome named outright: errors stay out of this
    // projection, but an agent whose run was refused must be able to tell
    // that from a run that failed on its own.
    deniedByUser: run.error === AGENT_RUN_DENIED_ERROR,
    failedNodes,
    failedNodeCount: failedNodes.length,
    nodeCount: run.results.length,
    workflowRev: run.workflowRev ?? null,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    resolvedSecrets: (run.resolvedSecrets ?? []).map((secret) => ({
      name: secret.name,
      scopeType: secret.scopeType,
      resolved: secret.resolved,
    })),
  }
}

/** Aggregate per-status counts over stored node results — constant shape, no per-node payload. */
function projectStatusCounts(results: Run["results"]): Record<string, JsonValue> {
  const counts: Record<string, number> = {}
  for (const result of results) {
    counts[result.status] = (counts[result.status] ?? 0) + 1
  }
  return counts as Record<string, JsonValue>
}

/**
 * One failed node's debug essentials. `expectedStatus` keeps a matched
 * negative test legible; `unresolvedPlaceholders` names references that went
 * out as literal text (a 401 with placeholders present is a missing value,
 * not bad credentials); `attemptCount` says a retrying request gave up after
 * that many tries; `failedScriptTests`/`scriptError` say a pre-request or
 * post-response script failed it. A failed browser step additionally says
 * which page it was on (`url`/`title` as stored: query-stripped and
 * secret-scrubbed at capture, the same masked values the debug context and
 * evidence read expose), its own value-free diagnosis, and the one read that
 * carries its full evidence. Bodies stay in the evidence tool.
 */
function projectFailedNode(result: RunResult, run: Pick<Run, "runId" | "workspaceId">): JsonValue {
  const response = isRecord(result.response) ? result.response : null
  const statusCode = response?.["statusCode"]
  const browser = result.browser
  const stepError = browserStepError(result.error)
  return {
    nodeId: result.nodeId,
    status: result.status,
    durationMs: result.duration,
    ...(result.expectedStatus !== undefined ? { expectedStatus: result.expectedStatus } : {}),
    unresolvedPlaceholders: result.unresolvedPlaceholders ? [...result.unresolvedPlaceholders] : [],
    hasError: typeof result.error === "string" && result.error.length > 0,
    ...(typeof statusCode === "number" ? { responseStatusCode: statusCode } : {}),
    // A retrying request that gave up: how many times it was sent.
    ...(result.attempts ? { attemptCount: result.attempts.length } : {}),
    // Script verdicts as counts; test names and console output stay in the evidence tool.
    ...(result.scripts
      ? {
          failedScriptTests: result.scripts.reduce((sum, script) => sum + script.tests.filter((test) => !test.passed).length, 0),
          scriptError: result.scripts.some((script) => script.error !== undefined),
        }
      : {}),
    ...(browser !== undefined
      ? {
          // Playwright's own account (`detail`), the compared values and the
          // ARIA snapshot stay in the evidence tool: this is the summary.
          browser: {
            action: browser.action,
            ...(browser.url !== undefined ? { url: browser.url } : {}),
            ...(browser.title !== undefined ? { title: browser.title } : {}),
            ...(stepError !== undefined ? { error: stepError } : {}),
          },
          nextRead: {
            tool: "runs_getNodeResult",
            args: {
              workspaceId: run.workspaceId,
              runId: run.runId,
              nodeIds: [result.nodeId],
              sections: ["browser"],
            },
          },
        }
      : {}),
  }
}

/**
 * A failed browser step's stored error, when it is the runner's own
 * browser-step diagnosis — the same prefix `safeErrorClass` trusts to keep a
 * message verbatim in run history — capped to a summary's size. Any other
 * stored error stays behind `hasError`: a message that is not the runner's
 * diagnosis is not ours to republish.
 */
function browserStepError(error: string | null | undefined): string | undefined {
  if (typeof error !== "string" || !error.startsWith(BROWSER_STEP_PREFIX)) return undefined
  return truncateUtf8Marked(error, FAILED_BROWSER_ERROR_BYTES)
}

const TERMINAL_STATUSES: ReadonlySet<Run["status"]> = new Set([
  "completed",
  "failed",
  "cancelled",
  "interrupted",
])

/**
 * The safe run-snapshot resource projection (plan §"Run resource"). Same
 * secret-safety posture as {@link projectRunToolResult} — metadata only, never
 * bodies/headers/cookies/URLs/values — but shaped as a compact current snapshot
 * with a per-node map for agent context.
 *
 * `latestSequence` is the broker's monotonic per-run counter (Phase 6) so a
 * subscribed client can tell whether a re-read reflects a newer state; it is 0
 * when the broker never saw the run (e.g. a historical run after restart).
 * `events` stays omitted — the subscription model is notify-then-re-read, not
 * an event stream, so the snapshot carries current state only.
 */
export function projectRunSnapshot(value: unknown, latestSequence = 0): Record<string, JsonValue> {
  const run = RunSchema.parse(value)
  return {
    runId: run.runId,
    workspaceId: run.workspaceId,
    workflowId: run.workflowId,
    status: run.status,
    terminal: TERMINAL_STATUSES.has(run.status),
    latestSequence,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    durationMs: run.duration ?? null,
    hasError: Boolean(run.error || run.failureMessage),
    nodes: projectSnapshotNodes(run),
  }
}

/** Merge per-node status/statusCode (nodeStatuses) with durationMs (results). */
function projectSnapshotNodes(run: Run): Record<string, JsonValue> {
  const nodes: Record<string, { status?: string; statusCode?: number; expectedStatus?: number | number[]; durationMs?: number }> = {}
  for (const [nodeId, entry] of Object.entries(run.nodeStatuses)) {
    if (typeof entry === "string") {
      nodes[nodeId] = { status: entry }
      continue
    }
    if (!isRecord(entry)) continue
    const node: { status?: string; statusCode?: number } = {}
    if (typeof entry["status"] === "string") node.status = entry["status"]
    if (typeof entry["statusCode"] === "number") node.statusCode = entry["statusCode"]
    nodes[nodeId] = node
  }
  for (const result of run.results) {
    const node = (nodes[result.nodeId] ??= {})
    if (result.status) node.status = result.status
    node.durationMs = result.duration
    const response = isRecord(result.response) ? result.response : null
    if (typeof response?.["statusCode"] === "number") node.statusCode = response["statusCode"]
    // Configured expectedStatus, so a matched negative test (a passed node
    // showing e.g. a 409) is legible directly from the snapshot.
    if (result.expectedStatus !== undefined) node.expectedStatus = result.expectedStatus
  }
  return nodes as Record<string, JsonValue>
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
