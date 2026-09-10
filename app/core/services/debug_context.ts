import { analyzeWorkflowGraph, buildGraph, traverse } from "@shared/analysis/workflow_graph_analyzer"
import { isCanvasOnlyNode } from "@shared/graph/frames"
import type { Environment } from "@shared/types/Environment"
import type { Run } from "@shared/types/Run"
import type { RunResult } from "@shared/types/RunResult"
import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowDebugContext } from "@shared/types/WorkflowDebugContext"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import { NotFoundError } from "../ipc/errors"
import {
  DEBUG_CONTEXT_DEFAULT_ERROR_BYTES,
  DEBUG_CONTEXT_DEFAULT_ISSUE_LIMIT,
  DEBUG_CONTEXT_MAX_NODE_DETAILS,
  INLINE_RESULT_BUDGET_BYTES,
  truncateUtf8,
} from "./read_budgets"
import type { EnvironmentService } from "./environment_service"
import type { RunService } from "./run_service"
import type { WorkflowService } from "./workflow_service"

export interface DebugContextRequest {
  readonly workspaceId: string
  readonly workflowId: string
  readonly runId?: string
  readonly nodeIds?: readonly string[]
  readonly issueLimit?: number
  readonly errorBytes?: number
}

/**
 * One-call debug orchestration for a known workflow (MCP optimization phase 3).
 *
 * The graph is read ONCE and that snapshot is analyzed; the run is resolved
 * ONCE (explicit `runId`, otherwise the latest failed run) and threaded
 * through every section, so sub-reads cannot disagree about which run or
 * revision they describe. Current workflow `rev` is returned separately from
 * the run record's own `runRev`, and graph correlation stays `unknown` because
 * run records do not carry the executed workflow revision — a past run is
 * never assumed to describe the graph now on canvas.
 *
 * Deterministic throughout: ordered failure ids, severity-ordered diagnosis,
 * sorted keys/secrets/placeholders, no LLM summarizer. Secret output is names
 * plus run-recorded resolution metadata only; values never enter this DTO (the
 * transport redacts configs and evidence a second time on the way out).
 */
export class DebugContextService {
  constructor(
    private readonly workflows: WorkflowService,
    private readonly runs: RunService,
    private readonly environments: EnvironmentService,
  ) {}

// fallow-ignore-next-line complexity
  async debugContext(request: DebugContextRequest): Promise<WorkflowDebugContext> {
    const workflow = await this.workflows.get(request.workspaceId, request.workflowId)
    const run = await this.resolveRun(request.workspaceId, request.workflowId, request.runId)
    const runSelection = {
      policy: (request.runId !== undefined ? "explicit" : "latest-failed") as "explicit" | "latest-failed",
      runId: run?.runId ?? null,
    }

    const resultsByNode = new Map((run?.results ?? []).map((result) => [result.nodeId, result]))
    const failureSummary = summarizeFailures(workflow, run, resultsByNode)
    const diagnosis = compactDiagnosis(workflow, run, request.issueLimit ?? DEBUG_CONTEXT_DEFAULT_ISSUE_LIMIT)

    const requested = dedupe(request.nodeIds ?? [])
    const byId = new Map(workflow.nodes.map((node) => [node.nodeId, node]))
    const missingNodeIds = requested.filter((nodeId) => !byId.has(nodeId)).sort()
    const relevant = relevantNodeIds(workflow, failureSummary, requested.filter((nodeId) => byId.has(nodeId)))
    const detailedIds = relevant.slice(0, DEBUG_CONTEXT_MAX_NODE_DETAILS)
    const omittedNodeIds = relevant.slice(DEBUG_CONTEXT_MAX_NODE_DETAILS)
    const detailed = new Set(detailedIds)

    const nodes = workflow.nodes.filter((node) => detailed.has(node.nodeId))
    const edges = workflow.edges.filter((edge) => detailed.has(edge.source) || detailed.has(edge.target))
    const boundaryNodes = boundaryIdentities(byId, edges, detailed)

    const errorBudget = request.errorBytes ?? DEBUG_CONTEXT_DEFAULT_ERROR_BYTES
    const evidence = run === null
      ? []
      : detailedIds.flatMap((nodeId) => {
        const result = resultsByNode.get(nodeId)
        return result === undefined ? [] : [buildEvidence(request.workspaceId, run.runId, result, errorBudget)]
      })

    const placeholders = collectPlaceholders(failureSummary, resultsByNode)
    const environment = await this.describeEnvironment(workflow, run, relevant, byId)
    const secrets = collectSecrets(relevant, byId, resultsByNode, run)

    const response: WorkflowDebugContext = {
      workflow: {
        workflowId: workflow.workflowId,
        workspaceId: workflow.workspaceId,
        name: workflow.name,
        rev: workflow.rev,
      },
      runSelection,
      run: run === null ? null : describeRun(run),
      graphCorrelation: {
        status: "unknown",
        reason: "Run records do not carry the executed workflow revision, so a past run cannot be proven to describe the current graph.",
      },
      failureSummary,
      diagnosis,
      nodes,
      edges,
      boundaryNodes,
      missingNodeIds,
      omittedNodeIds,
      totalRelevantNodeCount: relevant.length,
      evidence,
      placeholders,
      environment,
      secrets: secrets.items,
      totalSecretCount: secrets.total,
      budgetBytes: 0,
      budgetLimitBytes: INLINE_RESULT_BUDGET_BYTES,
      nextReads: [],
    }
    return fitBudget(response, workflow, request.workspaceId, request.workflowId, run?.runId ?? null, environment)
  }

  /**
   * Explicit run-selection policy: a named run must belong to this workflow
   * (existence-hiding, like `workflows.diagnose`), otherwise the latest failed
   * run — which may not exist, and that is a valid empty context, not an error.
   */
  private async resolveRun(workspaceId: string, workflowId: string, runId: string | undefined): Promise<Run | null> {
    if (runId !== undefined) {
      const run = await this.runs.get(workspaceId, runId)
      if (run.workflowId !== workflowId) {
        throw new NotFoundError(`run ${runId} not found`)
      }
      return run
    }
    return (await this.runs.getLatestFailed(workspaceId, workflowId)) ?? null
  }

  /**
   * Environment key presence over the EFFECTIVE variables of one evaluated
   * environment — the run's choice wins because that is what executed,
   * otherwise the workflow's current selection. Provenance names the nearest
   * environment in the base chain that defines each key; values never enter
   * the response, only presence and which layer provides them.
   */
  private async describeEnvironment(
    workflow: Workflow,
    run: Run | null,
    relevant: readonly string[],
    byId: ReadonlyMap<string, WorkflowNode>,
  ): Promise<WorkflowDebugContext["environment"]> {
    const workflowSelected = workflow.selectedEnvironmentId ?? null
    const runSelected = run?.selectedEnvironmentId ?? null
    const evaluatedId = runSelected ?? workflowSelected
    const names = collectEnvRefs(relevant, byId)
    if (evaluatedId === null) {
      return {
        workflowSelectedEnvironmentId: workflowSelected,
        runSelectedEnvironmentId: runSelected,
        evaluatedEnvironmentId: null,
        evaluatedEnvironmentName: null,
        keys: names.map((name) => ({ name, present: false, sourceEnvironmentId: null, sourceEnvironmentName: null })),
        totalKeyCount: names.length,
      }
    }
    const chain = await this.loadEnvChain(workflow.workspaceId, evaluatedId)
    const head = chain[0]
    const keys = names.map((name) => {
      const source = chain.find((env) => Object.prototype.hasOwnProperty.call(env.variables, name))
      return {
        name,
        present: source !== undefined,
        sourceEnvironmentId: source?.environmentId ?? null,
        sourceEnvironmentName: source?.name ?? null,
      }
    })
    return {
      workflowSelectedEnvironmentId: workflowSelected,
      runSelectedEnvironmentId: runSelected,
      evaluatedEnvironmentId: evaluatedId,
      evaluatedEnvironmentName: head?.name ?? null,
      keys,
      totalKeyCount: names.length,
    }
  }

  /**
   * Walk the `baseEnvironmentId` chain nearest-first, depth-bounded like the
   * repository resolver. A base outside this workspace stops the walk rather
   * than leaking across it (`environments.get` is workspace-scoped).
   */
  private async loadEnvChain(workspaceId: string, startId: string): Promise<Environment[]> {
    const chain: Environment[] = []
    const seen = new Set<string>()
    let current: string | null | undefined = startId
    for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth += 1) {
      if (seen.has(current)) break
      seen.add(current)
      try {
        const env = await this.environments.get(workspaceId, current)
        chain.push(env)
        current = env.baseEnvironmentId
      } catch (error) {
        if (error instanceof NotFoundError) break
        throw error
      }
    }
    return chain
  }
}

/** The workspace that owns the workflow — the only scope environments resolve in. */

function dedupe(ids: readonly string[]): string[] {
  return [...new Set(ids)]
}

function describeRun(run: Run): NonNullable<WorkflowDebugContext["run"]> {
  return {
    runId: run.runId,
    workflowId: run.workflowId,
    status: run.status,
    runRev: run.rev,
    trigger: run.trigger,
    ...(run.startedAt !== undefined ? { startedAt: run.startedAt } : {}),
    ...(run.completedAt !== undefined ? { completedAt: run.completedAt } : {}),
    ...(run.duration !== undefined ? { duration: run.duration } : {}),
    ...(run.selectedEnvironmentId !== undefined ? { selectedEnvironmentId: run.selectedEnvironmentId } : {}),
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
  }
}

const TERMINAL_RUN: ReadonlySet<Run["status"]> = new Set(["completed", "failed", "cancelled", "interrupted"])

/**
 * Failed ids from stored metadata plus failed results (either may be absent on
 * older rows); blocked ids are skipped results plus, on a terminal run, the
 * resultless executable nodes DOWNSTREAM of a failure — the branches that
 * failure starved. Absence of a result is not on its own evidence of being
 * blocked: the executor marks `end` nodes passed without persisting a result,
 * and a branch the run never took stores nothing either, so an unreachable
 * node set would report the end node and every untaken branch of a green run.
 * Canvas furniture never executes.
 */
// fallow-ignore-next-line complexity
function summarizeFailures(
  workflow: Workflow,
  run: Run | null,
  resultsByNode: ReadonlyMap<string, RunResult>,
): WorkflowDebugContext["failureSummary"] {
  if (run === null) {
    return { failedNodeIds: [], failedNodeCount: 0, blockedNodeIds: [], blockedNodeCount: 0 }
  }
  const failed = new Set<string>(run.failedNodes ?? [])
  for (const result of resultsByNode.values()) {
    if (result.status === "failed") failed.add(result.nodeId)
  }
  const failedNodeIds = [...failed].sort()
  const failedSet = new Set(failedNodeIds)

  const blocked = new Set<string>()
  for (const result of resultsByNode.values()) {
    if (result.status === "skipped" && !failedSet.has(result.nodeId)) blocked.add(result.nodeId)
  }
  if (TERMINAL_RUN.has(run.status)) {
    const { nodesById, successors } = buildGraph(workflow.nodes, workflow.edges)
    for (const nodeId of traverse(failedNodeIds, successors)) {
      const node = nodesById.get(nodeId)
      if (node === undefined || node.type === "start" || node.type === "end" || isCanvasOnlyNode(node)) continue
      if (!resultsByNode.has(nodeId) && !failedSet.has(nodeId)) blocked.add(nodeId)
    }
  }
  const blockedNodeIds = [...blocked].sort()
  return {
    failedNodeIds,
    failedNodeCount: failedNodeIds.length,
    blockedNodeIds,
    blockedNodeCount: blockedNodeIds.length,
  }
}

/**
 * The shared analyzer over the single workflow snapshot, compacted to the same
 * MCP diagnosis shape graph writes return: severity-ordered, evidence dropped
 * (it can carry values), bounded by `issueLimit` with the total preserved in
 * `omittedItemCount`. Static when no run was selected.
 */
function compactDiagnosis(
  workflow: Workflow,
  run: Run | null,
  issueLimit: number,
): WorkflowDebugContext["diagnosis"] {
  const full = analyzeWorkflowGraph(
    { workflowId: workflow.workflowId, nodes: workflow.nodes, edges: workflow.edges, variables: workflow.variables },
    ...(run === null ? [] : [run]),
  )
  const items = full.diagnostics.slice(0, Math.max(0, issueLimit)).map((item) => ({
    code: item.code,
    severity: item.severity,
    category: item.category,
    nodeIds: item.nodeIds,
    message: item.message,
    remediation: item.remediation,
  }))
  return {
    status: "complete",
    summary: full.summary,
    items,
    omittedItemCount: full.diagnostics.length - items.length,
  }
}

/**
 * Detail priority is the patch order: failures first, then explicitly
 * requested nodes in caller order, then one-hop predecessors (the configs a
 * fix must stay consistent with), then blocked downstream nodes. Canvas-only
 * nodes join only by explicit request — they never execute.
 */
// fallow-ignore-next-line complexity
function relevantNodeIds(
  workflow: Workflow,
  failureSummary: WorkflowDebugContext["failureSummary"],
  requestedExisting: readonly string[],
): string[] {
  const byId = new Map(workflow.nodes.map((node) => [node.nodeId, node]))
  const seen = new Set<string>()
  const relevant: string[] = []
  const take = (nodeId: string): void => {
    if (seen.has(nodeId) || !byId.has(nodeId)) return
    seen.add(nodeId)
    relevant.push(nodeId)
  }
  for (const nodeId of failureSummary.failedNodeIds) take(nodeId)
  for (const nodeId of requestedExisting) take(nodeId)
  const focus = new Set(seen)
  const predecessors = new Set<string>()
  for (const edge of workflow.edges) {
    if (focus.has(edge.target) && !seen.has(edge.source)) {
      const source = byId.get(edge.source)
      if (source !== undefined && !isCanvasOnlyNode(source)) predecessors.add(edge.source)
    }
  }
  for (const nodeId of [...predecessors].sort()) take(nodeId)
  for (const nodeId of failureSummary.blockedNodeIds) {
    const node = byId.get(nodeId)
    if (node !== undefined && !isCanvasOnlyNode(node)) take(nodeId)
  }
  return relevant
}

function boundaryIdentities(
  byId: ReadonlyMap<string, WorkflowNode>,
  edges: readonly WorkflowEdge[],
  detailed: ReadonlySet<string>,
): WorkflowDebugContext["boundaryNodes"] {
  const boundary = new Set<string>()
  for (const edge of edges) {
    if (detailed.has(edge.source) && !detailed.has(edge.target)) boundary.add(edge.target)
    if (detailed.has(edge.target) && !detailed.has(edge.source)) boundary.add(edge.source)
  }
  return [...boundary]
    .sort()
    .flatMap((nodeId) => {
      const node = byId.get(nodeId)
      return node === undefined ? [] : [{ nodeId: node.nodeId, type: node.type, label: node.label ?? null }]
    })
}

/** Bounded redacted-in-transport error evidence with a selector for full detail. */
// fallow-ignore-next-line complexity
function buildEvidence(
  workspaceId: string,
  runId: string,
  result: RunResult,
  errorBudget: number,
): WorkflowDebugContext["evidence"][number] {
  const error = typeof result.error === "string" ? result.error : ""
  const errorBytes = Buffer.byteLength(error, "utf8")
  const truncated = errorBytes > errorBudget
  const response = isRecord(result.response) ? result.response : null
  const statusCode = typeof response?.["statusCode"] === "number" ? response["statusCode"] : null
  return {
    nodeId: result.nodeId,
    status: result.status,
    hasError: error.length > 0,
    ...(error.length === 0 ? {} : { errorPreview: truncated ? truncateUtf8(error, errorBudget) : error }),
    errorTruncated: truncated,
    errorBytes,
    ...(result.expectedStatus !== undefined ? { expectedStatus: result.expectedStatus } : {}),
    responseStatusCode: statusCode,
    unresolvedPlaceholders: [...(result.unresolvedPlaceholders ?? [])],
    assertionFailureCount: (result.assertions ?? []).filter((item) => item.outcome === "fail").length,
    extractorMissCount: (result.extractorOutcomes ?? []).filter((outcome) => !outcome.matched).length,
    moreDetail: {
      tool: "runs_getNodeResult",
      args: {
        workspaceId,
        runId,
        nodeIds: [result.nodeId],
        sections: ["error", "assertions", "extractors", "request", "response"],
      },
    },
  }
}

/** Distinct unresolved placeholders across failed and blocked node results. */
function collectPlaceholders(
  failureSummary: WorkflowDebugContext["failureSummary"],
  resultsByNode: ReadonlyMap<string, RunResult>,
): WorkflowDebugContext["placeholders"] {
  const names = new Set<string>()
  for (const nodeId of [...failureSummary.failedNodeIds, ...failureSummary.blockedNodeIds]) {
    for (const name of resultsByNode.get(nodeId)?.unresolvedPlaceholders ?? []) names.add(name)
  }
  const unresolved = [...names].sort()
  return { unresolved, unresolvedCount: unresolved.length }
}

const ENV_REF_RE = /\{\{\s*env\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
const SECRET_REF_RE = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g

/** `{{env.NAME}}` references across every relevant node config — names only. */
function collectEnvRefs(relevant: readonly string[], byId: ReadonlyMap<string, WorkflowNode>): string[] {
  const names = new Set<string>()
  for (const nodeId of relevant) {
    for (const value of configStrings(byId.get(nodeId))) {
      ENV_REF_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = ENV_REF_RE.exec(value)) !== null) {
        const name = match[1]
        if (name !== undefined) names.add(name)
      }
    }
  }
  return [...names].sort()
}

/**
 * `{{secrets.NAME}}` references plus per-result `secretRefs`, resolved against
 * the run's stored resolution metadata when a run was selected. Names and
 * scope metadata only — values never enter this DTO.
 */
// fallow-ignore-next-line complexity
function collectSecrets(
  relevant: readonly string[],
  byId: ReadonlyMap<string, WorkflowNode>,
  resultsByNode: ReadonlyMap<string, RunResult>,
  run: Run | null,
): { items: WorkflowDebugContext["secrets"]; total: number } {
  const names = new Set<string>()
  for (const nodeId of relevant) {
    for (const value of configStrings(byId.get(nodeId))) {
      SECRET_REF_RE.lastIndex = 0
      let match: RegExpExecArray | null
      while ((match = SECRET_REF_RE.exec(value)) !== null) {
        const name = match[1]
        if (name !== undefined) names.add(name)
      }
    }
    for (const name of resultsByNode.get(nodeId)?.secretRefs ?? []) names.add(name)
  }
  const recorded = new Map((run?.resolvedSecrets ?? []).map((secret) => [secret.name, secret]))
  const items = [...names].sort().map((name) => {
    const hit = recorded.get(name)
    return {
      name,
      resolved: hit?.resolved ?? false,
      scopeType: hit?.scopeType ?? null,
      fromRun: hit !== undefined,
    }
  })
  return { items, total: items.length }
}

/** Every string leaf of a node config — the same walk the analyzer uses. */
function configStrings(node: WorkflowNode | undefined): string[] {
  const out: string[] = []
  const visit = (value: unknown): void => {
    if (typeof value === "string") {
      out.push(value)
    } else if (Array.isArray(value)) {
      for (const item of value) visit(item)
    } else if (value !== null && typeof value === "object") {
      for (const child of Object.values(value as Readonly<Record<string, unknown>>)) visit(child)
    }
  }
  const config = node?.config as Readonly<Record<string, unknown>> | undefined
  if (config !== undefined) visit(config)
  return out
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

/**
 * Hold the response to the aggregate inline budget. Drop order is
 * value-per-byte: error previews first (rows and selectors survive), then
 * diagnosis items from the notices end (summary counts survive), then node
 * detail entries from the lowest-priority end (counts, evidence selectors and
 * omission ids survive), then identifier tails with the continuation hints
 * already weighed. Metadata is never dropped, so this terminates with a valid,
 * explicitly partial response.
 */
function fitBudget(
  response: WorkflowDebugContext,
  workflow: Workflow,
  workspaceId: string,
  workflowId: string,
  runId: string | null,
  environment: WorkflowDebugContext["environment"],
): WorkflowDebugContext {
  const byId = new Map(workflow.nodes.map((node) => [node.nodeId, node]))
  const bytes = (): number => Buffer.byteLength(JSON.stringify(response), "utf8")
  dropErrorPreviews(response, bytes)
  dropDiagnosisTail(response, bytes)
  dropNodeDetails(response, byId, bytes)
  // The continuations are part of the response, so they go on the scales
  // before the last rung — appended afterwards they re-broke the budget the
  // ladder had just held. Node/diagnosis omissions are final by here, so the
  // hints they restate are accurate.
  response.nextReads = buildNextReads(response, workspaceId, workflowId, runId, environment)
  dropIdentifierTails(response, bytes)
  response.budgetBytes = bytes()
  response.budgetLimitBytes = INLINE_RESULT_BUDGET_BYTES
  return response
}

function overBudget(bytes: () => number): boolean {
  return bytes() > INLINE_RESULT_BUDGET_BYTES
}

function dropErrorPreviews(response: WorkflowDebugContext, bytes: () => number): void {
  while (overBudget(bytes)) {
    let victim: (typeof response.evidence)[number] | undefined
    for (const item of response.evidence) {
      if (item.errorPreview !== undefined && (victim === undefined || previewBytes(item.errorPreview) > previewBytes(victim.errorPreview))) {
        victim = item
      }
    }
    if (victim === undefined) return
    delete victim.errorPreview
    victim.errorTruncated = victim.errorBytes > 0
  }
}

function previewBytes(preview: string | undefined): number {
  return preview === undefined ? 0 : Buffer.byteLength(preview, "utf8")
}

function dropDiagnosisTail(response: WorkflowDebugContext, bytes: () => number): void {
  if (response.diagnosis.status !== "complete") return
  while (overBudget(bytes) && response.diagnosis.items.length > 0) {
    response.diagnosis.items.pop()
    response.diagnosis.omittedItemCount += 1
  }
}

function dropNodeDetails(
  response: WorkflowDebugContext,
  byId: ReadonlyMap<string, WorkflowNode>,
  bytes: () => number,
): void {
  while (overBudget(bytes) && response.nodes.length > 0) {
    const dropped = response.nodes[response.nodes.length - 1]
    response.nodes.pop()
    if (dropped !== undefined) {
      response.omittedNodeIds.unshift(dropped.nodeId)
      const detailed = new Set(response.nodes.map((node) => node.nodeId))
      response.edges = response.edges.filter((edge) => detailed.has(edge.source) || detailed.has(edge.target))
      response.boundaryNodes = boundaryIdentities(byId, response.edges, detailed)
    }
  }
}

/**
 * Last resort: shorten long identifier/key/secret tails. Every shortened list
 * keeps its authoritative total, so the omission is computable, and the
 * continuation in `nextReads` names what to read next.
 */
// fallow-ignore-next-line complexity
function dropIdentifierTails(response: WorkflowDebugContext, bytes: () => number): void {
  while (overBudget(bytes)) {
    let dropped = popOne(response.failureSummary.failedNodeIds)
    if (overBudget(bytes)) dropped = popOne(response.failureSummary.blockedNodeIds) || dropped
    if (overBudget(bytes)) dropped = popOne(response.placeholders.unresolved) || dropped
    if (overBudget(bytes)) dropped = popOne(response.environment.keys) || dropped
    if (overBudget(bytes)) dropped = popOne(response.secrets) || dropped
    if (!dropped) return
  }
}

function popOne(list: { length: number; pop(): unknown }): boolean {
  if (list.length === 0) return false
  list.pop()
  return true
}

function buildNextReads(
  response: WorkflowDebugContext,
  workspaceId: string,
  workflowId: string,
  runId: string | null,
  environment: WorkflowDebugContext["environment"],
): WorkflowDebugContext["nextReads"] {
  const nextReads: WorkflowDebugContext["nextReads"] = []
  if (response.omittedNodeIds.length > 0) {
    nextReads.push({
      tool: "workflows_get",
      args: {
        workspaceId,
        workflowId,
        view: "nodes",
        nodeIds: response.omittedNodeIds.slice(0, 50),
      },
      reason: `${response.omittedNodeIds.length} further relevant node(s) omitted by the detail cap or budget; read their configs plus incident edges here, in slices of at most 50.`,
    })
  }
  const omittedIssues = response.diagnosis.status === "complete" ? response.diagnosis.omittedItemCount : 0
  if (omittedIssues > 0) {
    nextReads.push({
      tool: "workflow_diagnose",
      args: {
        workspaceId,
        workflowId,
        ...(runId !== null ? { runId } : {}),
      },
      reason: `${omittedIssues} diagnosis item(s) omitted by the issue limit or budget; read the full run-correlated diagnosis here.`,
    })
  }
  if (response.run === null) {
    nextReads.push({
      tool: "runs_history",
      args: { workspaceId, workflowId },
      reason: "No failed run was found; list recent runs to pick an explicit runId.",
    })
  }
  const missingKeys = environment.keys.filter((key) => !key.present)
  if (environment.evaluatedEnvironmentId !== null && missingKeys.length > 0) {
    // The names are a hint, not a payload: an unbounded list is a second copy
    // of the key set that no rung of the ladder can shorten. Cap it and state
    // how many names were left out; `environment.keys` carries the rest.
    const named = missingKeys.slice(0, 10).map((key) => key.name)
    const unnamedCount = missingKeys.length - named.length
    const names = unnamedCount > 0 ? `${named.join(", ")}, +${unnamedCount} more` : named.join(", ")
    nextReads.push({
      tool: "environments_get",
      args: { workspaceId, environmentId: environment.evaluatedEnvironmentId },
      reason: `${missingKeys.length} referenced env key(s) (${names}) missing from the evaluated environment; inspect it here.`,
    })
  }
  return nextReads
}
