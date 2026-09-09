import { RunSchema } from "@shared/zod-schemas"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"

/**
 * MCP run reads intentionally expose operational metadata only. The desktop UI
 * still receives full local run payloads over IPC, while agents cannot read
 * bodies, headers, cookies, URLs, variable values, or assertion actual values
 * through the projected run tools. The one exception is runs.getNodeResult,
 * which returns bounded per-node evidence after the shared secret-redaction
 * pass; it does not go through this projection.
 *
 * Summaries aggregate: one row carries identity, status, timing, failure
 * counts and revision — never per-node results. A single read additionally
 * names every failed node with its expected status and unresolved
 * placeholders, so a matched negative test or a missing value is legible
 * without a second call. Per-node detail beyond that lives in the evidence
 * tool, in a single representation rather than duplicated nodeStatuses plus
 * results maps.
 */
export function projectRunToolResult(value: unknown): unknown {
  if (value === null) return null

  const run = RunSchema.safeParse(value)
  if (run.success) return projectRunSummary(run.data)

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

function projectRunSummary(run: Run): Record<string, JsonValue> {
  return {
    ...projectRunHistoryRow(run),
    statusCounts: projectStatusCounts(run.results),
    failedNodeDetails: run.results
      .filter((result) => result.status === "failed")
      .map((result) => projectFailedNode(result)),
  }
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
    failedNodes,
    failedNodeCount: failedNodes.length,
    nodeCount: run.results.length,
    runRev: run.rev,
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
 * not bad credentials). Bodies stay in the evidence tool.
 */
function projectFailedNode(result: RunResult): JsonValue {
  const response = isRecord(result.response) ? result.response : null
  const statusCode = response?.["statusCode"]
  return {
    nodeId: result.nodeId,
    status: result.status,
    durationMs: result.duration,
    ...(result.expectedStatus !== undefined ? { expectedStatus: result.expectedStatus } : {}),
    unresolvedPlaceholders: result.unresolvedPlaceholders ? [...result.unresolvedPlaceholders] : [],
    hasError: typeof result.error === "string" && result.error.length > 0,
    ...(typeof statusCode === "number" ? { responseStatusCode: statusCode } : {}),
  }
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
