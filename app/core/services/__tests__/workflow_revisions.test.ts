import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { gunzipSync } from "node:zlib"
import { initDatabase, type InitializedDatabase } from "../../db"
import {
  EnvironmentRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { ScopeResolver } from "../scope_resolver"
import { WorkflowService } from "../workflow_service"
import { RunService } from "../run_service"
import { EnvironmentService } from "../environment_service"
import { IpcRouter } from "../../ipc/router"
import { registerWorkflowHandlers } from "../../ipc/handlers/workflows"
import type { HandlerDeps } from "../../ipc/handlers/common"
import { ConflictError } from "../../ipc/errors"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

const MINUTE = 60_000

let db: InitializedDatabase
let workflows: WorkflowRepository
let service: WorkflowService
let router: IpcRouter
let workspaceId: string
let workflowId: string
let clock: number

const node = (nodeId: string): WorkflowNode => ({ nodeId, type: "delay", position: { x: 0, y: 0 }, config: { duration: 1 } }) as WorkflowNode

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] })
  clock = Date.parse("2026-10-01T09:00:00.000Z")
  vi.setSystemTime(clock)
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const scopeResolver = new ScopeResolver({
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  })
  service = new WorkflowService(workflows, scopeResolver)
  router = new IpcRouter()
  registerWorkflowHandlers(router, {
    workflows: service,
    runs: new RunService(new RunRepository(db.kvStore), scopeResolver),
    environments: new EnvironmentService(environments, scopeResolver),
  } as unknown as HandlerDeps)
  workspaceId = workspaces.create({ name: "Local", slug: "local" }).workspaceId
  workflowId = workflows.create({ workspaceId, name: "Orders", nodes: [node("a")] }).workflowId
})

afterEach(() => {
  db.close()
  vi.useRealTimers()
})

function advance(ms: number): void {
  clock += ms
  vi.setSystemTime(clock)
}

const canvasSave = (name: string) => service.update(workspaceId, workflowId, { name })
const revisions = () => workflows.revisions.list(workflowId)
const nodeIds = (nodes: readonly WorkflowNode[]) => nodes.map((entry) => entry.nodeId)

describe("workflow revisions", () => {
  it("keeps the canvas's state at most once per ten minutes of auto-saves", async () => {
    await canvasSave("v1")
    advance(MINUTE)
    await canvasSave("v2")
    advance(MINUTE)
    await canvasSave("v3")
    expect(revisions().map((revision) => revision.source)).toEqual(["canvas"])

    advance(10 * MINUTE)
    await canvasSave("v4")
    const list = revisions()
    expect(list).toHaveLength(2)
    // Newest first; each is the workflow just before the save that kept it.
    await expect(service.getRevision(workspaceId, workflowId, list[0]!.revisionId)).resolves.toMatchObject({ snapshot: { name: "v3" } })
    expect((await service.getRevision(workspaceId, workflowId, list[1]!.revisionId)).snapshot.name).toBe("Orders")
  })

  it("keeps the state before an agent edit, and the agent's result before the next canvas save", async () => {
    await canvasSave("mine")
    const result = await router.dispatch(
      { domain: "workflows", action: "patch", payload: { workspaceId, workflowId, upsertNodes: [node("b")] } },
      { agent: "Claude Code" },
    )
    expect(result.ok).toBe(true)
    advance(MINUTE)
    await canvasSave("mine again")

    const list = revisions()
    expect(list.map((revision) => revision.source)).toEqual(["canvas", "agent:Claude Code", "canvas"])
    const beforeAgent = await service.getRevision(workspaceId, workflowId, list[1]!.revisionId)
    expect(nodeIds(beforeAgent.snapshot.nodes)).toEqual(["a"])
    expect(beforeAgent.snapshot.name).toBe("mine")
    const agentResult = await service.getRevision(workspaceId, workflowId, list[0]!.revisionId)
    expect(nodeIds(agentResult.snapshot.nodes)).toEqual(["a", "b"])
  })

  it("does not keep the same content twice in a row", async () => {
    await service.update(workspaceId, workflowId, { name: "Orders" }, { source: "agent:a" })
    await service.update(workspaceId, workflowId, { name: "Orders" }, { source: "agent:a" })
    expect(revisions()).toHaveLength(1)
  })

  it("keeps one version per agent session, so sixty patches leave the state before the agent restorable", async () => {
    await canvasSave("mine")
    for (let index = 0; index < 60; index += 1) {
      await service.patch(workspaceId, workflowId, { upsertNodes: [node(`agent-${index}`)] }, "agent:Claude Code")
      advance(5_000)
    }

    const list = revisions()
    expect(list.map((revision) => revision.source)).toEqual(["agent:Claude Code", "canvas"])
    const beforeAgent = await service.getRevision(workspaceId, workflowId, list[0]!.revisionId)
    expect(beforeAgent.snapshot.name).toBe("mine")
    expect(nodeIds(beforeAgent.snapshot.nodes)).toEqual(["a"])
    const current = await service.get(workspaceId, workflowId)
    const restored = await service.restoreRevision(workspaceId, workflowId, list[0]!.revisionId, current.rev)
    expect(nodeIds(restored.nodes)).toEqual(["a"])
  })

  it("keeps the newest fifty, none older than ninety days", async () => {
    for (let index = 0; index < 55; index += 1) {
      await service.update(workspaceId, workflowId, { name: `agent ${index}` }, { source: "agent:a" })
      advance(10 * MINUTE)
    }
    expect(revisions()).toHaveLength(50)
    expect((await service.getRevision(workspaceId, workflowId, revisions()[0]!.revisionId)).snapshot.name).toBe("agent 53")

    advance(91 * 24 * 60 * MINUTE)
    await service.update(workspaceId, workflowId, { name: "much later" }, { source: "agent:a" })
    expect(revisions()).toHaveLength(1)
  })

  it("restores a revision through the revision check, and the restore can itself be undone", async () => {
    await service.patch(workspaceId, workflowId, { upsertNodes: [node("b")] }, "agent:a")
    const beforeAgent = revisions()[0]!
    const current = await service.get(workspaceId, workflowId)

    await expect(service.restoreRevision(workspaceId, workflowId, beforeAgent.revisionId, current.rev - 1))
      .rejects.toBeInstanceOf(ConflictError)

    const restored = await service.restoreRevision(workspaceId, workflowId, beforeAgent.revisionId, current.rev)
    expect(nodeIds(restored.nodes)).toEqual(["a"])
    expect(restored.rev).toBe(current.rev + 1)

    const beforeRestore = revisions()[0]!
    expect(beforeRestore.source).toBe("restore")
    const undone = await service.restoreRevision(workspaceId, workflowId, beforeRestore.revisionId, restored.rev)
    expect(nodeIds(undone.nodes)).toEqual(["a", "b"])
  })

  it("keeps nothing secret in a revision", async () => {
    await service.update(workspaceId, workflowId, {
      nodes: [{ ...node("a"), type: "http-request", config: { url: "https://x", headers: [{ key: "Authorization", value: "Bearer {{secrets.TOKEN}}", active: true }] } } as WorkflowNode],
    })
    const before = (await service.get(workspaceId, workflowId)).rev
    await service.update(workspaceId, workflowId, { name: "Agent", nodes: [] }, { source: "agent:a" })

    expect(revisions()[0]).toMatchObject({ source: "agent:a", nodeCount: 1, workflowRev: before })
    // A revision holds the workflow's own references-only config, as the row does.
    const stored = db.kvStore.query<{ snapshot: Buffer }>("SELECT snapshot FROM workflow_revisions")
    const text = stored.map((row) => gunzipSync(row.snapshot).toString("utf8")).join("\n")
    expect(text).toContain("{{secrets.TOKEN}}")
  })

  it("keeps no revision of a write that failed", async () => {
    const set = db.kvStore.set.bind(db.kvStore)
    vi.spyOn(db.kvStore, "set").mockImplementation((sql, params) => {
      if (sql.startsWith("UPDATE workflows SET name")) throw new Error("workflow write failed")
      return set(sql, params)
    })

    await expect(canvasSave("lost")).rejects.toThrow("workflow write failed")

    expect(revisions()).toEqual([])
    expect(workflows.getById(workflowId)?.name).toBe("Orders")
  })

  it("lists revisions over IPC, and refuses one of another workflow", async () => {
    await service.update(workspaceId, workflowId, { name: "x" }, { source: "import" })
    const list = await router.dispatch({ domain: "workflows", action: "listRevisions", payload: { workspaceId, workflowId } })
    expect(list.ok && Array.isArray(list.data) && list.data.length).toBe(1)
    const other = workflows.create({ workspaceId, name: "Other" }).workflowId
    const revisionId = revisions()[0]!.revisionId
    await expect(service.getRevision(workspaceId, other, revisionId)).rejects.toThrow("not found")
  })
})
