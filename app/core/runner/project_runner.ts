import type { Collection } from "@shared/types/Collection"
import type { ProjectRun } from "@shared/types/ProjectRun"
import type { ProjectRunItem } from "@shared/types/ProjectRunItem"
import type { RunTerminalStatus } from "@shared/types/RunProgressEvent"
import type { Workflow } from "@shared/types/Workflow"
import type { CollectionRepository } from "../repositories/CollectionRepository"
import type { EnvironmentRepository } from "../repositories/EnvironmentRepository"
import type { ProjectRunRepository } from "../repositories/ProjectRunRepository"
import type { RunRepository } from "../repositories/RunRepository"
import type { WorkflowRepository } from "../repositories/WorkflowRepository"
import { NotFoundError, ValidationError } from "../ipc/errors"

/** The part of {@link RunScheduler} a project run drives. */
export interface ProjectRunScheduler {
  enqueue(request: {
    readonly workspaceId: string
    readonly workflowId: string
    readonly selectedEnvironmentId: string | null
    readonly agent?: string
  }): string
  cancel(runId: string): boolean
  whenFinished(runId: string): Promise<RunTerminalStatus>
}

export interface ProjectRunnerDeps {
  readonly projectRuns: ProjectRunRepository
  readonly collections: CollectionRepository
  readonly workflows: WorkflowRepository
  readonly environments: EnvironmentRepository
  readonly runs: RunRepository
  readonly scheduler: ProjectRunScheduler
  /** Every write of a project run's record, in order: the renderer's progress feed, or a CLI's. */
  readonly onChange?: (projectRun: ProjectRun) => void
}

export interface ProjectRunRequest {
  readonly workspaceId: string
  readonly projectId: string
  /** Every workflow runs against this environment; null runs them with none. */
  readonly environmentId: string | null
  /** Set when an agent started the project run over MCP: each workflow's run then needs the user's approval to send secrets. */
  readonly agent?: string
}

export interface ProjectRunHandle {
  /** The record as created: `running`, every item `pending`. */
  readonly projectRun: ProjectRun
  /** Settles with the terminal record. Never rejects. */
  readonly done: Promise<ProjectRun>
}

interface ActiveProjectRun {
  readonly controller: AbortController
  currentRunId: string | null
}

/**
 * The workflows a project run executes, in order: the project's saved order
 * first, then any member not in it yet (oldest first), keeping only enabled
 * ones. An order entry for a workflow that has left the project is ignored.
 */
export function planProjectRun(project: Collection, members: readonly Workflow[]): ProjectRunItem[] {
  const byId = new Map(members.map((workflow) => [workflow.workflowId, workflow]))
  const rows: { workflowId: string; enabled: boolean; continueOnFail: boolean }[] = []
  const seen = new Set<string>()
  for (const entry of [...project.workflowOrder].sort((left, right) => left.order - right.order)) {
    if (!byId.has(entry.workflowId) || seen.has(entry.workflowId)) continue
    seen.add(entry.workflowId)
    rows.push(entry)
  }
  for (const workflow of [...members].reverse()) {
    if (!seen.has(workflow.workflowId)) rows.push({ workflowId: workflow.workflowId, enabled: true, continueOnFail: true })
  }
  return rows
    .filter((row) => row.enabled)
    .map((row) => ({
      workflowId: row.workflowId,
      workflowName: byId.get(row.workflowId)?.name ?? row.workflowId,
      continueOnFail: row.continueOnFail,
      runId: null,
      status: "pending",
      durationMs: null,
    }))
}

/**
 * Runs a project's enabled workflows one after another through the run
 * scheduler, so each is an ordinary run: history, secret masking,
 * cancellation and the agent approval prompt all apply per workflow.
 *
 * Semantics:
 * - A failed workflow stops the project unless its row says `continueOnFail`;
 *   the workflows after a stop are `skipped`. Any failure fails the project.
 * - A workflow run that ends `cancelled` or `interrupted` (cancelled from its
 *   canvas, or the app quitting) ends the project the same way.
 * - Variables do not flow between workflows: each run starts from its own
 *   workflow variables and the shared environment, like a run from the canvas.
 *
 * Plain Node — no Electron — so a headless runner can drive it.
 */
export class ProjectRunner {
  private readonly active = new Map<string, ActiveProjectRun>()

  public constructor(private readonly deps: ProjectRunnerDeps) {}

  /** Throws NotFoundError for a project or environment outside the workspace, ValidationError for nothing to run. */
  public start(request: ProjectRunRequest): ProjectRunHandle {
    const project = this.deps.collections.getById(request.projectId)
    if (project === undefined || project.workspaceId !== request.workspaceId) {
      throw new NotFoundError(`project ${request.projectId} not found`)
    }
    if (request.environmentId !== null) {
      const environment = this.deps.environments.getById(request.environmentId)
      if (environment === undefined || environment.workspaceId !== request.workspaceId) {
        throw new NotFoundError(`environment ${request.environmentId} not found`)
      }
    }
    const members = this.deps.workflows.listByCollection(request.workspaceId, request.projectId).items
    const items = planProjectRun(project, members)
    if (items.length === 0) throw new ValidationError("This project has no enabled workflows to run.")

    const projectRun = this.deps.projectRuns.create({ projectId: project.collectionId, environmentId: request.environmentId, items })
    const active: ActiveProjectRun = { controller: new AbortController(), currentRunId: null }
    this.active.set(projectRun.projectRunId, active)
    this.deps.onChange?.(projectRun)
    const done = this.execute(projectRun, request, active).finally(() => this.active.delete(projectRun.projectRunId))
    return { projectRun, done }
  }

  /** Stop a live project run: its current workflow run is cancelled and the rest are skipped. False when it is not running here. */
  public cancel(projectRunId: string): boolean {
    const active = this.active.get(projectRunId)
    if (active === undefined) return false
    active.controller.abort()
    if (active.currentRunId !== null) this.deps.scheduler.cancel(active.currentRunId)
    return true
  }

  /** A project run left live by a previous process ends `interrupted`; it is never resumed. */
  public reconcileOnStartup(): number {
    const stale = this.deps.projectRuns.listNonTerminal()
    for (const projectRun of stale) {
      const items = projectRun.items.map((item): ProjectRunItem => {
        if (item.status === "pending") return { ...item, status: "skipped" }
        if (item.status === "running") return { ...item, status: "interrupted" }
        return item
      })
      this.deps.projectRuns.update(projectRun.projectRunId, "interrupted", items)
    }
    return stale.length
  }

  private async execute(projectRun: ProjectRun, request: ProjectRunRequest, active: ActiveProjectRun): Promise<ProjectRun> {
    const items = [...projectRun.items]
    let status: ProjectRun["status"] = "completed"
    try {
      for (let index = 0; index < items.length; index++) {
        if (active.controller.signal.aborted) break
        const item = items[index]!
        let outcome: ProjectRunItem["status"]
        try {
          const runId = this.deps.scheduler.enqueue({
            workspaceId: request.workspaceId,
            workflowId: item.workflowId,
            selectedEnvironmentId: request.environmentId,
            ...(request.agent !== undefined ? { agent: request.agent } : {}),
          })
          active.currentRunId = runId
          items[index] = { ...item, runId, status: "running" }
          this.save(projectRun.projectRunId, "running", items)
          outcome = await this.deps.scheduler.whenFinished(runId)
          items[index] = { ...items[index]!, status: outcome, durationMs: this.deps.runs.getById(runId)?.duration ?? null }
        } catch {
          // The workflow left the project or was deleted after the plan was made.
          outcome = "failed"
          items[index] = { ...item, status: "failed" }
        } finally {
          active.currentRunId = null
        }
        if (outcome === "cancelled" || outcome === "interrupted") {
          status = outcome
          break
        }
        if (outcome === "failed") {
          status = "failed"
          if (!item.continueOnFail) break
        }
        this.save(projectRun.projectRunId, "running", items)
      }
    } catch {
      status = "failed"
    }
    if (active.controller.signal.aborted && status !== "interrupted") status = "cancelled"
    const final = items.map((item): ProjectRunItem => (item.status === "pending" ? { ...item, status: "skipped" } : item))
    try {
      return this.save(projectRun.projectRunId, status, final)
    } catch {
      // The database went away under us (the app is quitting). Startup
      // reconciliation will mark the stored record interrupted.
      return { ...projectRun, status, items: final }
    }
  }

  private save(projectRunId: string, status: ProjectRun["status"], items: readonly ProjectRunItem[]): ProjectRun {
    const saved = this.deps.projectRuns.update(projectRunId, status, items)
    if (saved === undefined) throw new NotFoundError(`project run ${projectRunId} not found`)
    this.deps.onChange?.(saved)
    return saved
  }
}
