import type { Run } from "../../../shared/types/Run"
import type { RunProgressEvent } from "../../../shared/types/RunProgressEvent"
import type { JsonValue } from "../../../shared/types/JsonValue"
import type { RunRepository } from "../repositories/RunRepository"
import type { WorkflowRepository } from "../repositories/WorkflowRepository"
import type { ClockProvider, RngProvider } from "./harness/providers"
import { WorkflowExecutor, type WorkflowGraph, type ExecutorDeps } from "./executor"
import { DynamicFunctions } from "./dynamic_functions"
import { SafeHttp } from "./safe_http"

const DEFAULT_CONCURRENCY_CAP = 4

export interface SchedulerDeps {
  readonly runs: RunRepository
  readonly workflows: WorkflowRepository
  readonly http: SafeHttp
  readonly functions: DynamicFunctions
  readonly clock: ClockProvider
  readonly rng: RngProvider
  readonly emitProgress?: (runId: string, event: RunProgressEvent) => void
  readonly concurrencyCap?: number
}

export interface EnqueueRequest {
  readonly workspaceId: string
  readonly workflowId: string
  readonly startNodeIds?: readonly string[]
  readonly variables?: Readonly<Record<string, unknown>>
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
    const run = this.deps.runs.create({
      workspaceId: request.workspaceId,
      workflowId: request.workflowId,
      status: "pending",
      ...(request.variables ? { variables: request.variables as Record<string, JsonValue> } : {}),
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

      const workflow = this.deps.workflows.getById(run.workflowId)
      if (!workflow) throw new Error(`workflow ${run.workflowId} not found`)

      const graph: WorkflowGraph = {
        nodes: workflow.nodes as unknown as WorkflowGraph["nodes"],
        edges: workflow.edges as unknown as WorkflowGraph["edges"],
        ...(run.variables ? { variables: run.variables as Record<string, unknown> } : {}),
      }

      const executorDeps: ExecutorDeps = {
        clock: this.deps.clock,
        rng: this.deps.rng,
        http: this.deps.http,
        functions: this.deps.functions,
        emitProgress: (event) => this.handleProgress(runId, event),
      }

      const executor = new WorkflowExecutor(executorDeps)
      const output = await executor.executeWorkflow(graph, {
        runId,
        cancelSignal: controller.signal,
        ...(run.resumeFromNodeIds ? { startNodeIds: run.resumeFromNodeIds } : {}),
      })

      const status: Run["status"] = output.status === "passed" ? "completed" : "failed"
      this.deps.runs.updateStatus(
        runId,
        status,
        status === "failed" ? "Workflow execution failed" : undefined,
      )
    } catch (error) {
      if (controller.signal.aborted) {
        this.deps.runs.updateStatus(runId, "cancelled")
      } else {
        this.deps.runs.updateStatus(runId, "failed", String(error))
      }
    } finally {
      this.activeRuns.delete(runId)
      void this.drain()
    }
  }

  private handleProgress(runId: string, event: RunProgressEvent): void {
    if (this.deps.emitProgress) {
      this.deps.emitProgress(runId, event)
    }
    this.deps.runs.appendNodeStatus(runId, event.nodeId, {
      status: event.status,
      variables: event.variables as JsonValue,
    })
  }
}
