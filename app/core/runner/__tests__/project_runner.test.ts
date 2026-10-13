import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, PROJECT_RUN_HISTORY_RETENTION_PER_PROJECT } from "../../db"
import type { InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  ProjectRunRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { RunScheduler } from "../scheduler"
import { ProjectRunner, planProjectRun, type ProjectRunScheduler } from "../project_runner"
import { DynamicFunctions } from "../dynamic_functions"
import { SafeHttp } from "../safe_http"
import { FixedClockProvider, SeededRandomProvider } from "../harness/providers"
import { NotFoundError, ValidationError } from "../../ipc/errors"
import type { ProjectRun } from "@shared/types/ProjectRun"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowOrderItem } from "@shared/types/WorkflowOrderItem"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let runs: RunRepository
let environments: EnvironmentRepository
let collections: CollectionRepository
let projectRuns: ProjectRunRepository
let scheduler: RunScheduler
let workspaceId: string

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  environments = new EnvironmentRepository(db.kvStore)
  collections = new CollectionRepository(db.kvStore)
  projectRuns = new ProjectRunRepository(db.kvStore)
  const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  scheduler = new RunScheduler({
    runs, workflows, environments, clock, rng,
    http: new SafeHttp(),
    functions: new DynamicFunctions(clock, rng),
  })
  workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
})

afterEach(async () => {
  await scheduler.shutdown(500)
  db.close()
})

type Kind = "pass" | "fail" | { delayMs: number }

function seedWorkflow(name: string, kind: Kind, collectionId: string | null = null): string {
  const middle: WorkflowNode =
    kind === "pass"
      ? { nodeId: "mid", type: "delay", position: { x: 1, y: 0 }, config: { duration: 0 } as never }
      : kind === "fail"
        // An empty URL fails the node without any network.
        ? { nodeId: "mid", type: "http-request", position: { x: 1, y: 0 }, config: { method: "GET", url: "" } as never }
        : { nodeId: "mid", type: "delay", position: { x: 1, y: 0 }, config: { duration: kind.delayMs } as never }
  const nodes: WorkflowNode[] = [
    { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
    middle,
    { nodeId: "end", type: "end", position: { x: 2, y: 0 } },
  ]
  const edges: WorkflowEdge[] = [
    { edgeId: "e1", source: "start", target: "mid" },
    { edgeId: "e2", source: "mid", target: "end" },
  ]
  return workflows.create({ workspaceId, name, nodes, edges, collectionId }).workflowId
}

function seedProject(rows: readonly { kind: Kind; enabled?: boolean; continueOnFail?: boolean }[]): {
  projectId: string
  workflowIds: string[]
} {
  const projectId = collections.create({ workspaceId, name: "Checkout" }).collectionId
  const workflowIds = rows.map((row, index) => seedWorkflow(`wf-${index}`, row.kind, projectId))
  const workflowOrder: WorkflowOrderItem[] = rows.map((row, index) => ({
    workflowId: workflowIds[index]!,
    order: index,
    enabled: row.enabled ?? true,
    continueOnFail: row.continueOnFail ?? true,
  }))
  collections.update(projectId, { workflowOrder })
  return { projectId, workflowIds }
}

function makeRunner(overrides: { scheduler?: ProjectRunScheduler; onChange?: (run: ProjectRun) => void } = {}): ProjectRunner {
  return new ProjectRunner({
    projectRuns, collections, workflows, environments, runs,
    scheduler: overrides.scheduler ?? scheduler,
    ...(overrides.onChange ? { onChange: overrides.onChange } : {}),
  })
}

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error("timed out")
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe("planProjectRun", () => {
  it("keeps the saved order, drops disabled rows and departed workflows, and appends unordered members oldest first", () => {
    const projectId = collections.create({ workspaceId, name: "P" }).collectionId
    const a = seedWorkflow("a", "pass", projectId)
    const b = seedWorkflow("b", "pass", projectId)
    const c = seedWorkflow("c", "pass", projectId)
    const d = seedWorkflow("d", "pass", projectId)
    const e = seedWorkflow("e", "pass", projectId)
    collections.update(projectId, {
      workflowOrder: [
        { workflowId: c, order: 0, enabled: true, continueOnFail: false },
        { workflowId: "gone", order: 1, enabled: true, continueOnFail: true },
        { workflowId: a, order: 2, enabled: true, continueOnFail: true },
        { workflowId: b, order: 3, enabled: false, continueOnFail: true },
      ],
    })
    const project = collections.getById(projectId)!
    const plan = planProjectRun(project, workflows.listByCollection(workspaceId, projectId).items)
    // d and e can share a creation millisecond, so only their place after the ordered rows is fixed.
    expect(plan.slice(0, 2).map((item) => item.workflowId)).toEqual([c, a])
    expect(new Set(plan.slice(2).map((item) => item.workflowId))).toEqual(new Set([d, e]))
    expect(plan[0]).toEqual({ workflowId: c, workflowName: "c", continueOnFail: false, runId: null, status: "pending", durationMs: null })
  })
})

describe("ProjectRunner", () => {
  it("runs the enabled workflows in order against the chosen environment", async () => {
    const { projectId, workflowIds } = seedProject([{ kind: "pass" }, { kind: "pass", enabled: false }, { kind: "pass" }])
    const environmentId = environments.create({ workspaceId, name: "staging", variables: {} }).environmentId
    const changes: ProjectRun[] = []
    const { projectRun, done } = makeRunner({ onChange: (run) => changes.push(run) }).start({ workspaceId, projectId, environmentId })
    expect(projectRun.status).toBe("running")

    const final = await done
    expect(final.status).toBe("completed")
    expect(final.finishedAt).not.toBeNull()
    expect(final.items.map((item) => [item.workflowId, item.status])).toEqual([
      [workflowIds[0], "completed"],
      [workflowIds[2], "completed"],
    ])
    for (const item of final.items) {
      const run = runs.getById(item.runId!)!
      expect(run.workflowId).toBe(item.workflowId)
      expect(run.selectedEnvironmentId).toBe(environmentId)
      expect(item.durationMs).not.toBeNull()
    }
    // The second workflow was enqueued only after the first had finished.
    expect(Date.parse(runs.getById(final.items[1]!.runId!)!.startedAt!)).toBeGreaterThanOrEqual(
      Date.parse(runs.getById(final.items[0]!.runId!)!.completedAt!),
    )
    expect(changes.at(-1)).toEqual(final)
    expect(projectRuns.getById(projectRun.projectRunId)).toEqual(final)
  })

  it("stops at a failed workflow whose row says stop, and skips the rest", async () => {
    const { projectId } = seedProject([{ kind: "pass" }, { kind: "fail", continueOnFail: false }, { kind: "pass" }])
    const final = await makeRunner().start({ workspaceId, projectId, environmentId: null }).done
    expect(final.status).toBe("failed")
    expect(final.items.map((item) => item.status)).toEqual(["completed", "failed", "skipped"])
    expect(final.items[2]!.runId).toBeNull()
  })

  it("goes on past a failed workflow whose row says continue, and still fails the project", async () => {
    const { projectId } = seedProject([{ kind: "fail", continueOnFail: true }, { kind: "pass" }])
    const final = await makeRunner().start({ workspaceId, projectId, environmentId: null }).done
    expect(final.status).toBe("failed")
    expect(final.items.map((item) => item.status)).toEqual(["failed", "completed"])
  })

  it("cancels the running workflow and skips the rest", async () => {
    const { projectId } = seedProject([{ kind: { delayMs: 5000 } }, { kind: "pass" }])
    const runner = makeRunner()
    const { projectRun, done } = runner.start({ workspaceId, projectId, environmentId: null })
    await waitFor(() => projectRuns.getById(projectRun.projectRunId)?.items[0]?.runId != null)
    expect(runner.cancel(projectRun.projectRunId)).toBe(true)

    const final = await done
    expect(final.status).toBe("cancelled")
    expect(final.items.map((item) => item.status)).toEqual(["cancelled", "skipped"])
    expect(runs.getById(final.items[0]!.runId!)!.status).toBe("cancelled")
    expect(runner.cancel(projectRun.projectRunId)).toBe(false)
  })

  it("starts each workflow's run as the agent that started the project run", async () => {
    const { projectId } = seedProject([{ kind: "pass" }, { kind: "pass" }])
    const agents: (string | undefined)[] = []
    const spy: ProjectRunScheduler = {
      enqueue: (request) => {
        agents.push(request.agent)
        return scheduler.enqueue(request)
      },
      cancel: (runId) => scheduler.cancel(runId),
      whenFinished: (runId) => scheduler.whenFinished(runId),
    }
    await makeRunner({ scheduler: spy }).start({ workspaceId, projectId, environmentId: null, agent: "claude-code" }).done
    expect(agents).toEqual(["claude-code", "claude-code"])
  })

  it("refuses a project or environment from another workspace, and a project with nothing enabled", () => {
    const { projectId } = seedProject([{ kind: "pass", enabled: false }])
    const runner = makeRunner()
    expect(() => runner.start({ workspaceId, projectId, environmentId: null })).toThrow(ValidationError)

    const other = workspaces.create({ name: "Other", slug: "other" }).workspaceId
    expect(() => runner.start({ workspaceId: other, projectId, environmentId: null })).toThrow(NotFoundError)
    const foreignEnv = environments.create({ workspaceId: other, name: "prod", variables: {} }).environmentId
    expect(() => runner.start({ workspaceId, projectId, environmentId: foreignEnv })).toThrow(NotFoundError)
    expect(projectRuns.listByProject(projectId)).toEqual([])
  })

  it("marks a project run left live by a previous process interrupted", () => {
    const { projectId, workflowIds } = seedProject([{ kind: "pass" }, { kind: "pass" }])
    const project = collections.getById(projectId)!
    const [first, second] = planProjectRun(project, workflows.listByCollection(workspaceId, projectId).items)
    const stale = projectRuns.create({
      projectId,
      environmentId: null,
      items: [{ ...first!, status: "running", runId: "r1" }, second!],
    })
    expect(makeRunner().reconcileOnStartup()).toBe(1)
    const after = projectRuns.getById(stale.projectRunId)!
    expect(after.status).toBe("interrupted")
    expect(after.items.map((item) => [item.workflowId, item.status])).toEqual([
      [workflowIds[0], "interrupted"],
      [workflowIds[1], "skipped"],
    ])
  })
})

describe("ProjectRunRepository", () => {
  it("keeps the newest finished project runs per project and goes with its project", async () => {
    const projectId = collections.create({ workspaceId, name: "P" }).collectionId
    const live = projectRuns.create({ projectId, environmentId: null, items: [] })
    // Strictly older than every finished one, so it falls outside the cap.
    await new Promise((resolve) => setTimeout(resolve, 5))
    for (let index = 0; index < PROJECT_RUN_HISTORY_RETENTION_PER_PROJECT + 3; index++) {
      const run = projectRuns.create({ projectId, environmentId: null, items: [] })
      projectRuns.update(run.projectRunId, "completed", [])
    }
    const kept = projectRuns.listByProject(projectId)
    // Retention counts every row but never deletes a live one.
    expect(kept.length).toBe(PROJECT_RUN_HISTORY_RETENTION_PER_PROJECT + 1)
    expect(kept.some((run) => run.projectRunId === live.projectRunId)).toBe(true)

    collections.delete(projectId)
    expect(projectRuns.getById(live.projectRunId)).toBeUndefined()
  })

  it("forgets a deleted environment instead of dangling it", () => {
    const projectId = collections.create({ workspaceId, name: "P" }).collectionId
    const environmentId = environments.create({ workspaceId, name: "dev", variables: {} }).environmentId
    const run = projectRuns.create({ projectId, environmentId, items: [] })
    environments.delete(environmentId)
    expect(projectRuns.getById(run.projectRunId)!.environmentId).toBeNull()
  })
})
