import { RunSchema } from "@shared/zod-schemas"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"

/**
 * MCP run reads intentionally expose operational metadata only. The desktop UI
 * still receives full local run payloads over IPC, while agents cannot read
 * bodies, headers, cookies, URLs, variable values, or assertion actual values.
 */
export function projectRunToolResult(value: unknown): unknown {
  if (value === null) return null

  const run = RunSchema.safeParse(value)
  if (run.success) return projectRun(run.data)

  if (isRecord(value) && Array.isArray(value["items"])) {
    return {
      total: typeof value["total"] === "number" ? value["total"] : value["items"].length,
      items: value["items"].map((item) => {
        const parsed = RunSchema.safeParse(item)
        return parsed.success ? projectRun(parsed.data) : null
      }).filter((item) => item !== null),
    }
  }

  throw new Error("MCP run projection received an unexpected handler result")
}

function projectRun(run: Run): Record<string, JsonValue> {
  return {
    runId: run.runId,
    workspaceId: run.workspaceId,
    workflowId: run.workflowId,
    selectedEnvironmentId: run.selectedEnvironmentId ?? null,
    status: run.status,
    trigger: run.trigger,
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    duration: run.duration ?? null,
    hasError: Boolean(run.error || run.failureMessage),
    failedNodes: run.failedNodes ? [...run.failedNodes] : [],
    nodeStatuses: projectNodeStatuses(run.nodeStatuses),
    results: run.results.map(projectResult),
    resumeFromRunId: run.resumeFromRunId ?? null,
    resumeFromNodeIds: run.resumeFromNodeIds ? [...run.resumeFromNodeIds] : [],
    resumeMode: run.resumeMode ?? null,
    resolvedSecrets: (run.resolvedSecrets ?? []).map((secret) => ({
      name: secret.name,
      scopeType: secret.scopeType,
      resolved: secret.resolved,
    })),
    rev: run.rev,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

function projectNodeStatuses(statuses: Run["nodeStatuses"]): Record<string, JsonValue> {
  const projected: Record<string, JsonValue> = {}
  for (const [nodeId, entry] of Object.entries(statuses)) {
    if (typeof entry === "string") {
      projected[nodeId] = { status: entry }
      continue
    }
    if (!isRecord(entry)) continue
    const status = entry["status"]
    const statusCode = entry["statusCode"]
    projected[nodeId] = {
      ...(typeof status === "string" ? { status } : {}),
      ...(typeof statusCode === "number" ? { statusCode } : {}),
      hasError: typeof entry["error"] === "string" || typeof entry["message"] === "string",
    }
  }
  return projected
}

function projectResult(result: RunResult): JsonValue {
  const response = isRecord(result.response) ? result.response : null
  const statusCode = response?.["statusCode"]
  const truncated = response?.["truncated"]
  return {
    nodeId: result.nodeId,
    status: result.status,
    duration: result.duration,
    startedAt: result.startedAt ?? null,
    completedAt: result.completedAt ?? null,
    secretRefs: result.secretRefs ? [...result.secretRefs] : [],
    hasError: typeof result.error === "string" && result.error.length > 0,
    response: {
      ...(typeof statusCode === "number" ? { statusCode } : {}),
      ...(typeof truncated === "boolean" ? { truncated } : {}),
    },
    assertions: (result.assertions ?? []).map((assertion) => ({
      ruleIndex: assertion.ruleIndex,
      source: assertion.source,
      path: assertion.path,
      operator: assertion.operator,
      sourceNodeId: assertion.sourceNodeId,
      expectedState: assertion.expectedState,
      expectedType: assertion.expectedType,
      actualState: assertion.actualState,
      actualType: assertion.actualType,
      outcome: assertion.outcome,
      reasonCode: assertion.reasonCode,
    })),
    extractorOutcomes: (result.extractorOutcomes ?? []).map((outcome) => ({
      producerNodeId: outcome.producerNodeId,
      variableName: outcome.variableName,
      path: outcome.path,
      matched: outcome.matched,
      observedType: outcome.observedType,
      failureReason: outcome.failureReason ?? null,
    })),
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
 * ponytail: no `latestSequence`/`events` here — those need the run event broker,
 * which lands in Phase 6. A one-shot read has no monotonic sequence to report.
 */
export function projectRunSnapshot(value: unknown): Record<string, JsonValue> {
  const run = RunSchema.parse(value)
  return {
    runId: run.runId,
    workspaceId: run.workspaceId,
    workflowId: run.workflowId,
    status: run.status,
    terminal: TERMINAL_STATUSES.has(run.status),
    startedAt: run.startedAt ?? null,
    completedAt: run.completedAt ?? null,
    durationMs: run.duration ?? null,
    hasError: Boolean(run.error || run.failureMessage),
    nodes: projectSnapshotNodes(run),
  }
}

/** Merge per-node status/statusCode (nodeStatuses) with durationMs (results). */
function projectSnapshotNodes(run: Run): Record<string, JsonValue> {
  const nodes: Record<string, { status?: string; statusCode?: number; durationMs?: number }> = {}
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
  }
  return nodes as Record<string, JsonValue>
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
