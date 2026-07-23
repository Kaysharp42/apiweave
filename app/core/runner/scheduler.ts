import type { Run } from "@shared/types/Run"
import type { RunProgressEvent } from "@shared/types/RunProgressEvent"
import type { JsonValue } from "@shared/types/JsonValue"
import type { RunRepository } from "../repositories/RunRepository"
import type { WorkflowRepository } from "../repositories/WorkflowRepository"
import type { EnvironmentRepository } from "../repositories/EnvironmentRepository"
import type { ClockProvider, RngProvider } from "./harness/providers"
import { WorkflowExecutor, type WorkflowGraph, type ExecutorDeps } from "./executor"
import { DynamicFunctions } from "./dynamic_functions"
import { SafeHttp } from "./safe_http"
import { NotFoundError } from "../ipc/errors"

const DEFAULT_CONCURRENCY_CAP = 4

export interface SchedulerDeps {
  readonly runs: RunRepository
  readonly workflows: WorkflowRepository
  readonly environments?: EnvironmentRepository
  readonly http: SafeHttp
  readonly functions: DynamicFunctions
  readonly clock: ClockProvider
  readonly rng: RngProvider
  readonly emitProgress?: (runId: string, event: RunProgressEvent) => void
  readonly concurrencyCap?: number
  /** Trusted runtime secret resolver — opens sealed boxes down the env > workspace chain. */
  readonly resolveSecret?: (name: string, chain: { environmentId?: string; workspaceId?: string }) => Promise<string | null>
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
    if (!this.deps.workflows.getByIdInWorkspace(request.workflowId, request.workspaceId)) {
      throw new NotFoundError(`workflow ${request.workflowId} not found`)
    }
    const run = this.deps.runs.create({
      workspaceId: request.workspaceId,
      workflowId: request.workflowId,
      status: "pending",
      ...(request.variables ? { variables: request.variables as Record<string, JsonValue> } : {}),
      ...(request.selectedEnvironmentId !== undefined ? { selectedEnvironmentId: request.selectedEnvironmentId } : {}),
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

    try {
      const run = this.deps.runs.getById(runId)
      if (!run) throw new Error(`run ${runId} not found after create`)

      // Defense-in-depth: re-assert workflow ownership at execution time (enqueue
      // already checked), so a run row can never execute a graph outside its workspace.
      const workflow = this.deps.workflows.getByIdInWorkspace(run.workflowId, run.workspaceId)
      if (!workflow) throw new Error(`workflow ${run.workflowId} not found`)

      const graph: WorkflowGraph = {
        nodes: workflow.nodes as unknown as WorkflowGraph["nodes"],
        edges: workflow.edges as unknown as WorkflowGraph["edges"],
        ...(run.variables ? { variables: run.variables as Record<string, unknown> } : {}),
      }

      const selectedEnvironmentId = run.selectedEnvironmentId ?? workflow.selectedEnvironmentId ?? null
      const environment = selectedEnvironmentId ? this.deps.environments?.getById(selectedEnvironmentId) : undefined
      if (selectedEnvironmentId && (environment === undefined || environment.workspaceId !== run.workspaceId)) {
        throw new Error(`environment ${selectedEnvironmentId} not found for run ${runId}`)
      }

      const executorDeps: ExecutorDeps = {
        clock: this.deps.clock,
        rng: this.deps.rng,
        http: this.deps.http,
        functions: this.deps.functions,
        ...(environment ? { environmentVariables: environment.variables as Record<string, unknown> } : {}),
        ...(await this.resolveRunSecrets(graph, selectedEnvironmentId, run.workspaceId)),
        emitProgress: (event) => this.handleProgress(runId, event),
      }

      const executor = new WorkflowExecutor(executorDeps)
      const output = await executor.executeWorkflow(graph, {
        runId,
        cancelSignal: controller.signal,
        ...(run.resumeFromNodeIds ? { startNodeIds: run.resumeFromNodeIds } : {}),
      })

      this.deps.runs.updateResults(runId, output.results)

      const status: Run["status"] = output.status === "passed" ? "completed" : "failed"
      this.deps.runs.updateStatus(
        runId,
        status,
        status === "failed" ? "Workflow execution failed" : undefined,
      )
      this.emitFinished(runId, status)
    } catch (error) {
      if (controller.signal.aborted) {
        this.deps.runs.updateStatus(runId, "cancelled")
        this.emitFinished(runId, "cancelled")
      } else {
        this.deps.runs.updateStatus(runId, "failed", String(error))
        this.emitFinished(runId, "failed")
      }
    } finally {
      this.activeRuns.delete(runId)
      void this.drain()
    }
  }

  private emitFinished(runId: string, status: "completed" | "failed" | "cancelled" | "interrupted"): void {
    this.deps.emitProgress?.(runId, { kind: "run.finished", runId, status })
  }

  /**
   * Scan the workflow graph for `{{secrets.NAME}}` references, resolve each down
   * the env > workspace chain, and return a name -> plaintext map for the executor.
   * Returns nothing when no resolver is wired or no references exist.
   */
  private async resolveRunSecrets(
    graph: WorkflowGraph,
    environmentId: string | null,
    workspaceId: string,
  ): Promise<{ secrets?: Record<string, string> }> {
    const resolver = this.deps.resolveSecret
    if (!resolver) return {}

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
    if (names.size === 0) return {}

    const chain = { ...(environmentId ? { environmentId } : {}), workspaceId }
    const secrets: Record<string, string> = {}
    for (const name of names) {
      const plaintext = await resolver(name, chain)
      if (plaintext !== null) secrets[name] = plaintext
    }
    return { secrets }
  }

  private handleProgress(runId: string, event: RunProgressEvent): void {
    // The executor only ever hands us node events; the terminal event is emitted
    // separately by emitFinished. Narrow so appendNodeStatus stays node-only.
    if (event.kind !== "node.completed") return
    this.deps.emitProgress?.(runId, event)
    this.deps.runs.appendNodeStatus(runId, event.nodeId, {
      status: event.status,
      variables: event.variables as JsonValue,
      ...(event.error ? { error: event.error } : {}),
      ...(event.message ? { message: event.message } : {}),
      ...(event.statusCode !== undefined ? { statusCode: event.statusCode } : {}),
    })
  }
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
