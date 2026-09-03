import type { Run } from "@shared/types/Run"
import type { ResolvedSecretInfo } from "@shared/types/ResolvedSecretInfo"
import type { RunEvent, RunTerminalStatus } from "@shared/types/RunProgressEvent"
import type { JsonValue } from "@shared/types/JsonValue"
import { withoutFrameNodes } from "@shared/graph/frames"
import type { RunResult } from "@shared/types/RunResult"
import type { RunRepository } from "../repositories/RunRepository"
import type { WorkflowRepository } from "../repositories/WorkflowRepository"
import type { EnvironmentRepository } from "../repositories/EnvironmentRepository"
import type { ClockProvider, RngProvider } from "./harness/providers"
import { WorkflowExecutor, type WorkflowGraph, type ExecutorDeps, type ExecutorProgressEvent, type NodeResultEvent, type ResolvedSubWorkflow } from "./executor"
import { DynamicFunctions } from "./dynamic_functions"
import { SafeHttp } from "./safe_http"
import { NotFoundError } from "../ipc/errors"
import { sanitizeVariablesForExport } from "../services/secret_utils"

const DEFAULT_CONCURRENCY_CAP = 4

export interface SchedulerDeps {
  readonly runs: RunRepository
  readonly workflows: WorkflowRepository
  readonly environments?: EnvironmentRepository
  readonly http: SafeHttp
  readonly functions: DynamicFunctions
  readonly clock: ClockProvider
  readonly rng: RngProvider
  readonly emitProgress?: (runId: string, event: RunEvent) => void
  readonly concurrencyCap?: number
  /** Trusted runtime secret resolver — opens sealed boxes down the env > workspace
   * chain. Returns the plaintext plus which scope won (or null/null when unset),
   * so the run can record safe resolution metadata for masked-secret debugging. */
  readonly resolveSecret?: (
    name: string,
    chain: { environmentId?: string; workspaceId?: string },
  ) => Promise<{ plaintext: string | null; scopeType: "environment" | "workspace" | null }>
}

export interface EnqueueRequest {
  readonly workspaceId: string
  readonly workflowId: string
  readonly startNodeIds?: readonly string[]
  readonly variables?: Readonly<Record<string, unknown>>
  readonly selectedEnvironmentId?: string | null
}

/**
 * In-process async run scheduler. Ports Python `run_service.trigger_workflow_run`
 * + `worker.py` into a single-process queue with a concurrency cap.
 *
 * On startup, `reconcileOnStartup()` marks any runs left in `pending`/`running`
 * as `interrupted` (terminal) — never auto-resumes. Re-run is the user's choice.
 *
 * Cancellation: per-run `AbortController`; the executor checks between nodes.
 * Progress: the executor's `node.completed` events are proxied to the renderer
 * via the `emitProgress` dep AND written to the DB via `appendNodeStatus`
 * (field-level, decision #6b).
 */
export class RunScheduler {
  private readonly activeRuns = new Map<string, AbortController>()
  private readonly queue: string[] = []
  private draining = false

  public constructor(private readonly deps: SchedulerDeps) {}

  public getActiveCount(): number {
    return this.activeRuns.size
  }

  public getQueueLength(): number {
    return this.queue.length
  }

  public enqueue(request: EnqueueRequest): string {
    // Object-level ownership check: the workflow must live in the run's workspace.
    // RunService authorizes the workspaceId but passes workflowId through untouched,
    // so without this a caller could execute another workspace's graph under their
    // run. Existence-hiding 404 mirrors WorkflowService's scoped reads.
    const workflow = this.deps.workflows.getByIdInWorkspace(request.workflowId, request.workspaceId)
    if (!workflow) {
      throw new NotFoundError(`workflow ${request.workflowId} not found`)
    }
    // Inherit the workflow's stored `selectedEnvironmentId` when the caller
    // omits it (an MCP agent running a workflow without a UI dropdown, or the
    // canvas's Run button before the environment picker has a value). Without
    // this, `runs_create` echoes `selectedEnvironmentId: null` even when the
    // workflow has one set, the run row stays null, and any `{{env.*}}`
    // placeholder goes out as literal text — a 401 from the target that is
    // indistinguishable from wrong credentials. `undefined` means "use the
    // workflow's default"; an explicit `null` means "run with no environment".
    // The execute-time fallback (`run.selectedEnvironmentId ?? workflow.selectedEnvironmentId`)
    // is kept as defense-in-depth, but the run row now reflects what will
    // actually run, so the echo and the run agree.
    const inheritedEnvironmentId =
      request.selectedEnvironmentId === undefined
        ? workflow.selectedEnvironmentId ?? null
        : request.selectedEnvironmentId
    const run = this.deps.runs.create({
      workspaceId: request.workspaceId,
      workflowId: request.workflowId,
      status: "pending",
      ...(request.variables ? { variables: request.variables as Record<string, JsonValue> } : {}),
      selectedEnvironmentId: inheritedEnvironmentId,
    })
    this.queue.push(run.runId)
    void this.drain()
    return run.runId
  }

  public cancel(runId: string): boolean {
    const controller = this.activeRuns.get(runId)
    if (controller) {
      controller.abort()
      return true
    }
    const idx = this.queue.indexOf(runId)
    if (idx >= 0) {
      this.queue.splice(idx, 1)
      this.deps.runs.updateStatus(runId, "cancelled")
      // A queued run never reached executeRun, so nothing else will publish its
      // terminal event — do it here or a subscriber waits forever (Phase 6).
      this.emitFinished(runId, "cancelled")
      return true
    }
    return false
  }

  public reconcileOnStartup(): number {
    const nonTerminal = this.deps.runs.listNonTerminal()
    for (const run of nonTerminal) {
      this.deps.runs.updateStatus(run.runId, "interrupted")
    }
    return nonTerminal.length
  }

  public async shutdown(graceMs = 2000): Promise<void> {
    for (const controller of this.activeRuns.values()) {
      controller.abort()
    }
    const deadline = Date.now() + graceMs
    while (this.activeRuns.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
    for (const runId of this.activeRuns.keys()) {
      this.deps.runs.updateStatus(runId, "interrupted")
      // The abort above may not have driven executeRun's catch to a terminal
      // publish before the grace window closed — publish once here (the broker
      // dedups a later duplicate terminal).
      this.emitFinished(runId, "interrupted")
    }
    // Runs still queued never started; mark and publish a terminal so any
    // subscriber unwinds rather than hanging on a run that will never run.
    for (const runId of this.queue) {
      this.deps.runs.updateStatus(runId, "interrupted")
      this.emitFinished(runId, "interrupted")
    }
    this.queue.length = 0
  }

  private async drain(): Promise<void> {
    if (this.draining) return
    this.draining = true
    try {
      const cap = this.deps.concurrencyCap ?? DEFAULT_CONCURRENCY_CAP
      while (this.queue.length > 0 && this.activeRuns.size < cap) {
        const runId = this.queue.shift()!
        void this.executeRun(runId)
      }
    } finally {
      this.draining = false
    }
  }

  private async executeRun(runId: string): Promise<void> {
    const controller = new AbortController()
    this.activeRuns.set(runId, controller)
    this.deps.runs.updateStatus(runId, "running")
    this.deps.emitProgress?.(runId, { kind: "run.started", runId })

    try {
      const run = this.deps.runs.getById(runId)
      if (!run) throw new Error(`run ${runId} not found after create`)

      // Defense-in-depth: re-assert workflow ownership at execution time (enqueue
      // already checked), so a run row can never execute a graph outside its workspace.
      const workflow = this.deps.workflows.getByIdInWorkspace(run.workflowId, run.workspaceId)
      if (!workflow) throw new Error(`workflow ${run.workflowId} not found`)

      const mergedVariables = { ...workflow.variables, ...(run.variables ?? {}) }
      const graph: WorkflowGraph = {
        // Group frames are canvas furniture with no edges. Left in, the executor
        // answers them with `{ status: "skipped" }` — a row in the run timeline
        // and the JUnit report for something that was never a step.
        nodes: withoutFrameNodes(workflow.nodes) as unknown as WorkflowGraph["nodes"],
        edges: workflow.edges as unknown as WorkflowGraph["edges"],
        ...(Object.keys(mergedVariables).length > 0 ? { variables: mergedVariables as Record<string, unknown> } : {}),
      }

      const selectedEnvironmentId = run.selectedEnvironmentId ?? workflow.selectedEnvironmentId ?? null
      const environments = this.deps.environments
      const environment = selectedEnvironmentId ? environments?.getById(selectedEnvironmentId) : undefined
      if (selectedEnvironmentId && (environment === undefined || environment.workspaceId !== run.workspaceId)) {
        throw new Error(`environment ${selectedEnvironmentId} not found for run ${runId}`)
      }

      const secretResolution = await this.resolveRunSecrets(graph, selectedEnvironmentId, run.workspaceId)
      if (secretResolution.resolvedSecrets.length > 0) {
        void this.deps.runs.setResolvedSecrets(runId, secretResolution.resolvedSecrets)
      }

      const executorDeps: ExecutorDeps = {
        clock: this.deps.clock,
        rng: this.deps.rng,
        http: this.deps.http,
        functions: this.deps.functions,
        ...(environment && environments
          ? {
              environmentVariables: environments.resolveEffectiveVariables(
                environment.environmentId,
              ) as Record<string, unknown>,
            }
          : {}),
        ...(secretResolution.secrets ? { secrets: secretResolution.secrets } : {}),
        emitProgress: (event) => this.handleProgress(runId, event),
        resolveWorkflow: (workflowId): ResolvedSubWorkflow | undefined => {
          const target = this.deps.workflows.getByIdInWorkspace(workflowId, run.workspaceId)
          if (!target) return undefined
          return {
            name: target.name,
            nodes: withoutFrameNodes(target.nodes) as unknown as WorkflowGraph["nodes"],
            edges: target.edges as unknown as WorkflowGraph["edges"],
            variables: target.variables as Record<string, unknown>,
          }
        },
      }

      const executor = new WorkflowExecutor(executorDeps)
      const output = await executor.executeWorkflow(graph, {
        runId,
        cancelSignal: controller.signal,
        ...(run.resumeFromNodeIds ? { startNodeIds: run.resumeFromNodeIds } : {}),
      })

      const extractedVariables = sanitizeFinalVariables(output)
      const failureMessage = safeFailureMessage(output.failedNodes)
      this.deps.runs.updateExecutionEvidence(runId, {
        results: sanitizeRunResults(output.results),
        extractedVariables,
        failedNodes: output.failedNodes,
        failureMessage,
      })

      const status: Run["status"] = output.status === "passed" ? "completed" : "failed"
      this.deps.runs.updateStatus(
        runId,
        status,
        status === "failed" ? failureMessage ?? "Workflow execution failed" : undefined,
      )
      this.emitFinished(runId, status)
    } catch {
      if (controller.signal.aborted) {
        this.deps.runs.updateStatus(runId, "cancelled")
        this.emitFinished(runId, "cancelled")
      } else {
        const existing = this.deps.runs.getById(runId)
        if (existing) {
          this.deps.runs.updateExecutionEvidence(runId, {
            results: existing.results,
            extractedVariables: sanitizeVariablesForExport(existing.variables),
            failedNodes: existing.failedNodes ?? [],
            failureMessage: "Workflow execution failed",
          })
        }
        this.deps.runs.updateStatus(runId, "failed", "Workflow execution failed")
        this.emitFinished(runId, "failed")
      }
    } finally {
      this.activeRuns.delete(runId)
      void this.drain()
    }
  }

  private emitFinished(runId: string, status: RunTerminalStatus): void {
    this.deps.emitProgress?.(runId, { kind: "run.finished", runId, status })
  }

  /**
   * Scan the workflow graph for `{{secrets.NAME}}` references, resolve each down
   * the env > workspace chain, and return a name -> plaintext map for the executor.
   * Also records safe resolution metadata (name/scope/resolved) on
   * {@link lastResolvedSecrets} for masked-secret debugging — never values.
   * Returns nothing when no resolver is wired or no references exist.
   */
  private async resolveRunSecrets(
    graph: WorkflowGraph,
    environmentId: string | null,
    workspaceId: string,
  ): Promise<{ secrets?: Record<string, string>; resolvedSecrets: ResolvedSecretInfo[] }> {
    const resolver = this.deps.resolveSecret
    if (!resolver) return { resolvedSecrets: [] }

    const names = new Set<string>()
    const pattern = /\{\{\s*secrets\.([A-Za-z_][A-Za-z0-9_]*)\s*\}\}/g
    for (const node of graph.nodes) {
      const config = node.config
      if (!config) continue
      for (const value of collectStrings(config)) {
        let m: RegExpExecArray | null
        while ((m = pattern.exec(value)) !== null) {
          names.add(m[1]!)
        }
      }
    }
    if (names.size === 0) return { resolvedSecrets: [] }

    const chain = { ...(environmentId ? { environmentId } : {}), workspaceId }
    const secrets: Record<string, string> = {}
    const resolvedSecrets: ResolvedSecretInfo[] = []
    for (const name of names) {
      const { plaintext, scopeType } = await resolver(name, chain)
      resolvedSecrets.push({ name, scopeType, resolved: plaintext !== null })
      if (plaintext !== null) secrets[name] = plaintext
    }
    return { ...(Object.keys(secrets).length > 0 ? { secrets } : {}), resolvedSecrets }
  }

  private handleProgress(runId: string, event: ExecutorProgressEvent): void {
    if (event.kind === "node.result") {
      this.handleNodeResult(runId, event)
      return
    }
    // The executor only ever hands us node events; started/terminal events are
    // emitted separately. Narrow so appendNodeStatus stays node-only.
    if (event.kind !== "node.status") return
    // A workflow can extract a token/password/api-key into a variable; redact
    // secret-looking keys/values the same way exports do before this snapshot
    // goes out over IPC and into run history (readable via runs.get/list, incl. MCP).
    const sanitizedVariables = sanitizeVariablesForExport(event.variables as Record<string, JsonValue>)
    const sanitizedError = event.error ? safeErrorClass(event.error) : undefined
    const sanitizedEvent: RunEvent = {
      ...event,
      variables: sanitizedVariables,
      ...(sanitizedError ? { error: sanitizedError } : {}),
    }
    this.deps.emitProgress?.(runId, sanitizedEvent)
    this.deps.runs.appendNodeStatus(runId, event.nodeId, {
      status: event.status,
      variables: sanitizedVariables,
      ...(sanitizedError ? { error: sanitizedError } : {}),
      ...(event.message ? { message: event.message } : {}),
      ...(event.statusCode !== undefined ? { statusCode: event.statusCode } : {}),
    })
  }

  // Persist the completed node immediately so runs_getNodeResult is useful
  // while independent branches are still running. This event deliberately
  // never reaches the progress broker because it can carry request/response
  // bodies; MCP and renderer subscribers only receive the safe status event.
  private handleNodeResult(runId: string, event: NodeResultEvent): void {
    const result = sanitizeRunResults([event.result])[0]
    if (result !== undefined) this.deps.runs.upsertNodeResult(runId, result)
  }
}

function sanitizeFinalVariables(output: Awaited<ReturnType<WorkflowExecutor["executeWorkflow"]>>): Record<string, JsonValue> {
  // Redact secret-looking keys/values only (same posture as the failure path and
  // per-node snapshots). Real extracted values are kept for the trusted local run
  // history — the MCP run projection never exposes variables, so there is nothing
  // to mask them from over the wire.
  return sanitizeVariablesForExport(output.extractedVariables as Record<string, JsonValue>)
}

function safeFailureMessage(failedNodes: readonly string[]): string | null {
  if (failedNodes.length === 0) return null
  return failedNodes.length === 1
    ? "Workflow execution failed in 1 node"
    : `Workflow execution failed in ${failedNodes.length} nodes`
}

function sanitizeRunResults(results: readonly RunResult[]): RunResult[] {
  return results.map((result) => ({
    ...result,
    request: sanitizeRequestMetadata(result.request),
    ...(typeof result.error === "string" ? { error: safeErrorClass(result.error) } : {}),
  }))
}

function sanitizeRequestMetadata(request: JsonValue | undefined): JsonValue {
  if (request === null || typeof request !== "object" || Array.isArray(request)) return request ?? null
  const url = request["url"]
  if (typeof url !== "string") return request
  try {
    const parsed = new URL(url)
    const safeUrl = `${parsed.protocol}//${parsed.host}${parsed.pathname}${parsed.search ? "?<REDACTED>" : ""}`
    return { ...request, url: safeUrl }
  } catch {
    return { ...request, url: "<URL>" }
  }
}

function safeErrorClass(error: string): string {
  const normalized = error.toLowerCase()
  if (normalized.includes("ssrf blocked")) return "SSRF blocked"
  if (normalized.includes("timeout") || normalized.includes("timed out") || normalized.includes("aborted")) {
    return "Request timed out"
  }
  if (normalized.includes("url is required") || normalized.includes("failed to build request")) {
    return "Request configuration invalid"
  }
  return "Node execution failed"
}

/** Recursively collect every string value within a node config (mirrors Python _iter_config_values). */
function collectStrings(obj: unknown): string[] {
  if (typeof obj === "string") return [obj]
  if (Array.isArray(obj)) return obj.flatMap(collectStrings)
  if (obj !== null && typeof obj === "object") {
    return Object.values(obj).flatMap(collectStrings)
  }
  return []
}
