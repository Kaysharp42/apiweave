import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { CollectionService } from "../collection_service"
import { EnvironmentService } from "../environment_service"
import { ProjectExportService } from "../project_export_service"
import { RunService } from "../run_service"
import { WorkflowService } from "../workflow_service"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let runs: RunRepository
let environments: EnvironmentRepository
let collections: CollectionRepository
let scopeResolver: ScopeResolver
const permissions = new LocalOwnerProvider()
const sync = new LocalOnlySyncProvider()

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  environments = new EnvironmentRepository(db.kvStore)
  collections = new CollectionRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  scopeResolver = new ScopeResolver(existence)
})

afterEach(() => db.close())

function seedWorkspace(slug: string): string {
  return workspaces.create({ name: slug, slug }).workspaceId
}

describe("WorkflowService — scope + permission round-trip (QA: task-12-service-happy)", () => {
  it("creates, gets, and lists within a known workspace; hides unknown workspaces as not_found", async () => {
    const wsA = seedWorkspace("a")
    const service = new WorkflowService(workflows, sync, permissions, scopeResolver)

    const created = await service.create(wsA, { name: "demo" })
    expect(created.name).toBe("demo")
    expect(await service.get(wsA, created.workflowId)).toMatchObject({ workflowId: created.workflowId })

    const listed = await service.list(wsA)
    expect(listed.items.map((w) => w.workflowId)).toContain(created.workflowId)

    // Existence-hiding: unknown scope is not_found, NEVER denied.
    await expect(service.create("ws-unknown", { name: "x" })).rejects.toMatchObject({ code: "not_found" })
  })

  it("hides a workflow from another workspace as not_found (no cross-scope read)", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const service = new WorkflowService(workflows, sync, permissions, scopeResolver)
    const created = await service.create(wsA, { name: "demo" })
    await expect(service.get(wsB, created.workflowId)).rejects.toMatchObject({ code: "not_found" })
  })
})

describe("CollectionService — membership + delete conflict", () => {
  it("refuses to delete a collection while workflows are still attached", async () => {
    const ws = seedWorkspace("a")
    const collectionService = new CollectionService(collections, workflows, sync, permissions, scopeResolver)
    const workflowService = new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments)

    const collection = await collectionService.create(ws, { name: "Col" })
    const workflow = await workflowService.create(ws, { name: "wf" })
    await collectionService.addWorkflow(ws, collection.collectionId, workflow.workflowId)

    expect((await collectionService.get(ws, collection.collectionId)).workflowCount).toBe(1)
    await expect(collectionService.delete(ws, collection.collectionId)).rejects.toMatchObject({ code: "conflict" })

    await collectionService.removeWorkflow(ws, collection.collectionId, workflow.workflowId)
    await expect(collectionService.delete(ws, collection.collectionId)).resolves.toBeUndefined()
  })
})

describe("RunService — field-level writes (decision #6b)", () => {
  it("patches node_statuses per node without clobbering siblings, then finalizes status", async () => {
    const ws = seedWorkspace("a")
    const workflow = workflows.create({ workspaceId: ws, name: "wf" })
    const runService = new RunService(runs, sync, permissions, scopeResolver)

    const run = await runService.createRun(ws, { workflowId: workflow.workflowId })
    runService.appendNodeStatus(run.runId, "n1", { status: "passed" })
    runService.appendNodeStatus(run.runId, "n2", { status: "failed" })
    runService.setExtractedVariables(run.runId, { userId: 42 })

    const patched = runs.getById(run.runId)
    expect(patched?.nodeStatuses).toEqual({ n1: { status: "passed" }, n2: { status: "failed" } })
    expect(patched?.variables).toEqual({ userId: 42 })

    const finalized = runService.completeRun(run.runId, "completed")
    expect(finalized?.status).toBe("completed")
    // Terminal transition must NOT wipe the per-node progress.
    expect(finalized?.nodeStatuses).toEqual({ n1: { status: "passed" }, n2: { status: "failed" } })
    expect(finalized?.completedAt).toEqual(expect.any(String))
  })
})

describe("EnvironmentService — variable ops", () => {
  it("sets and deletes variables within scope", async () => {
    const ws = seedWorkspace("a")
    const service = new EnvironmentService(environments, sync, permissions, scopeResolver)
    const env = await service.create(ws, { name: "Env" })
    const withVar = await service.setVariable(ws, env.environmentId, "base", "http://x")
    expect(withVar.variables).toEqual({ base: "http://x" })
    const cleared = await service.deleteVariable(ws, env.environmentId, "base")
    expect(cleared.variables).toEqual({})
  })
})

describe("ProjectExportService — v2 .awecollection round-trip (QA: task-12-awecollection-roundtrip)", () => {
  const clock = () => "2026-01-01T00:00:00.000Z"

  function exportService(): ProjectExportService {
    return new ProjectExportService(
      collections,
      workflows,
      environments,
      sync,
      permissions,
      scopeResolver,
      undefined,
      clock,
    )
  }

  it("round-trips structure byte-equal (modulo ids) and never leaks secret plaintext", async () => {
    const wsA = seedWorkspace("a")
    const env = environments.create({
      workspaceId: wsA,
      name: "Env",
      variables: { apiKey: "sekret-value", base: "http://api" },
    })
    const collection = collections.create({ workspaceId: wsA, name: "Col", color: "#123456" })
    workflows.create({
      workspaceId: wsA,
      name: "WF",
      collectionId: collection.collectionId,
      selectedEnvironmentId: env.environmentId,
      variables: { token: "plaintext-token", url: "{{secrets.MY_KEY}}" },
      tags: ["smoke"],
    })

    const bundle = await exportService().exportProject(wsA, collection.collectionId)

    // Format + sanitization invariants.
    expect(bundle.schemaVersion).toBe("2.0")
    expect(bundle.type).toBe("awecollection")
    expect(bundle.workflows[0]?.variables).toEqual({ token: "<SECRET>", url: "{{secrets.MY_KEY}}" })
    expect(bundle.environments[0]?.variables).toEqual({ apiKey: "<SECRET>", base: "http://api" })
    expect(bundle.secretReferences.map((r) => r.name).sort()).toEqual(["MY_KEY", "apiKey"])

    // Security negative: no secret plaintext anywhere in the serialized bundle.
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain("plaintext-token")
    expect(serialized).not.toContain("sekret-value")

    // Import into a fresh workspace, then re-export and compare the structure.
    const wsB = seedWorkspace("b")
    const importService = exportService()
    const result = await importService.importProject(wsB, bundle)
    expect(result.workflowCount).toBe(1)
    expect(result.environmentCount).toBe(1)
    expect(result.missingSecrets.slice().sort()).toEqual(["MY_KEY", "apiKey"])

    const project2 = collections.listByWorkspace(wsB).items[0]!
    const bundle2 = await exportService().exportProject(wsB, project2.collectionId)

    expect(bundle2.workflows[0]?.variables).toEqual(bundle.workflows[0]?.variables)
    expect(bundle2.workflows[0]?.name).toBe(bundle.workflows[0]?.name)
    expect(bundle2.workflows[0]?.tags).toEqual(bundle.workflows[0]?.tags)
    expect(bundle2.secretReferences.map((r) => r.name).sort()).toEqual(
      bundle.secretReferences.map((r) => r.name).sort(),
    )
  })

  it("dry-run flags a bad node and warns on schema drift", async () => {
    const ws = seedWorkspace("a")
    const bundle = {
      schemaVersion: "1.5",
      type: "awecollection" as const,
      project: { projectId: "p", name: "P", description: "", color: "#000000" },
      workflows: [{ workflowId: "w", name: "W", description: "", nodes: [{}], edges: [], variables: {}, tags: [], selectedEnvironmentId: null }],
      environments: [],
      secretReferences: [],
      metadata: { exportedAt: "", schemaVersion: "1.5", workflowCount: 1, environmentCount: 0, secretReferenceCount: 0 },
    }
    const result = await new ProjectExportService(
      collections,
      workflows,
      environments,
      sync,
      permissions,
      scopeResolver,
    ).dryRunImport(ws, bundle)
    expect(result.valid).toBe(false)
    expect(result.errors.some((e) => e.includes("nodeId"))).toBe(true)
    expect(result.warnings.some((w) => w.includes("schema version"))).toBe(true)
  })
})
