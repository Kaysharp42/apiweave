import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { CollectionService } from "../collection_service"
import { EnvironmentService } from "../environment_service"
import { NodePresetService } from "../node_preset_service"
import { ProjectExportService } from "../project_export_service"
import { RunService } from "../run_service"
import { WorkflowService } from "../workflow_service"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let runs: RunRepository
let environments: EnvironmentRepository
let collections: CollectionRepository
let presets: NodePresetRepository
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
  presets = new NodePresetRepository(db.kvStore)
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

  it("rejects create/update with a collectionId or environmentId from another workspace", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const foreignCollection = collections.create({ workspaceId: wsB, name: "Foreign" })
    const foreignEnv = environments.create({ workspaceId: wsB, name: "Foreign" })
    const service = new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments)

    await expect(
      service.create(wsA, { name: "demo", collectionId: foreignCollection.collectionId }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      service.create(wsA, { name: "demo", selectedEnvironmentId: foreignEnv.environmentId }),
    ).rejects.toMatchObject({ code: "not_found" })

    const created = await service.create(wsA, { name: "demo" })
    await expect(
      service.update(wsA, created.workflowId, { collectionId: foreignCollection.collectionId }),
    ).rejects.toMatchObject({ code: "not_found" })
    await expect(
      service.update(wsA, created.workflowId, { selectedEnvironmentId: foreignEnv.environmentId }),
    ).rejects.toMatchObject({ code: "not_found" })

    // Attached collection's own workflow listing/count never picks up the rejected attempts.
    expect(workflows.listByCollection(wsB, foreignCollection.collectionId).total).toBe(0)
  })
})

describe("WorkflowService — Call Workflow node target validation", () => {
  function callWorkflowNode(targetWorkflowId: string) {
    return [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      { nodeId: "call1", type: "workflow", position: { x: 1, y: 0 }, config: { targetWorkflowId } },
    ] as const
  }

  it("rejects a target workflow from another workspace as not_found", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const foreignTarget = workflows.create({ workspaceId: wsB, name: "Foreign target" })
    const service = new WorkflowService(workflows, sync, permissions, scopeResolver)

    await expect(
      service.create(wsA, { name: "caller", nodes: [...callWorkflowNode(foreignTarget.workflowId)] }),
    ).rejects.toMatchObject({ code: "not_found" })

    const created = await service.create(wsA, { name: "caller" })
    await expect(
      service.update(wsA, created.workflowId, { nodes: [...callWorkflowNode(foreignTarget.workflowId)] }),
    ).rejects.toMatchObject({ code: "not_found" })
  })

  it("rejects a direct self-call but accepts a valid same-workspace target", async () => {
    const ws = seedWorkspace("a")
    const service = new WorkflowService(workflows, sync, permissions, scopeResolver)
    const target = await service.create(ws, { name: "target" })
    const created = await service.create(ws, { name: "caller" })

    await expect(
      service.update(ws, created.workflowId, { nodes: [...callWorkflowNode(created.workflowId)] }),
    ).rejects.toMatchObject({ code: "validation" })

    const updated = await service.update(ws, created.workflowId, {
      nodes: [...callWorkflowNode(target.workflowId)],
    })
    expect(updated.nodes.find((n) => n.nodeId === "call1")?.config).toMatchObject({
      targetWorkflowId: target.workflowId,
    })
  })

  it("does not walk the transitive call graph — an indirect cycle is accepted at write time", async () => {
    // A -> B is fine on its own. B -> A (closing the loop) is ALSO accepted at
    // write time, by design: assertCallWorkflowTargetsInWorkspace only checks
    // direct self-reference, not the full call graph (see the comment on that
    // method). The runner's depth-bounded recursion guard is what actually
    // stops this from hanging at execution time — covered in executor.test.ts.
    const ws = seedWorkspace("a")
    const service = new WorkflowService(workflows, sync, permissions, scopeResolver)
    const a = await service.create(ws, { name: "A" })
    const b = await service.create(ws, { name: "B", nodes: [...callWorkflowNode(a.workflowId)] })

    await expect(
      service.update(ws, a.workflowId, { nodes: [...callWorkflowNode(b.workflowId)] }),
    ).resolves.toMatchObject({ workflowId: a.workflowId })
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

describe("EnvironmentService — base environment inheritance", () => {
  it("rejects a base environment from another workspace as not_found", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const foreignBase = environments.create({ workspaceId: wsB, name: "Foreign base" })
    const service = new EnvironmentService(environments, sync, permissions, scopeResolver)

    await expect(
      service.create(wsA, { name: "Env", baseEnvironmentId: foreignBase.environmentId }),
    ).rejects.toMatchObject({ code: "validation" })

    const created = await service.create(wsA, { name: "Env" })
    await expect(
      service.update(wsA, created.environmentId, { baseEnvironmentId: foreignBase.environmentId }),
    ).rejects.toMatchObject({ code: "validation" })
  })

  it("rejects self-reference and cycles, but accepts a valid multi-level chain", async () => {
    const ws = seedWorkspace("a")
    const service = new EnvironmentService(environments, sync, permissions, scopeResolver)

    const base = await service.create(ws, { name: "base", variables: { region: "eu" } })
    const mid = await service.create(ws, { name: "mid", baseEnvironmentId: base.environmentId, variables: { host: "mid" } })

    await expect(service.update(ws, mid.environmentId, { baseEnvironmentId: mid.environmentId })).rejects.toMatchObject({
      code: "validation",
    })
    // base -> mid would close the loop mid already opened (mid's base is base).
    await expect(service.update(ws, base.environmentId, { baseEnvironmentId: mid.environmentId })).rejects.toMatchObject({
      code: "validation",
    })

    const leaf = await service.create(ws, { name: "leaf", baseEnvironmentId: mid.environmentId, variables: { token: "t" } })
    expect(environments.resolveEffectiveVariables(leaf.environmentId)).toEqual({
      region: "eu",
      host: "mid",
      token: "t",
    })
  })
})

describe("NodePresetService — workspace-scoped preset library", () => {
  function service(): NodePresetService {
    return new NodePresetService(presets, permissions, scopeResolver)
  }

  it("creates, lists, updates, and deletes within one workspace", async () => {
    const ws = seedWorkspace("a")
    const svc = service()

    const created = await svc.create(ws, {
      name: "Standard auth headers",
      nodeType: "http-request",
      config: { headers: [{ key: "Authorization", value: "Bearer {{secrets.TOKEN}}" }] },
    })
    expect(created).toMatchObject({ workspaceId: ws, nodeType: "http-request" })

    expect((await svc.list(ws)).items.map((p) => p.presetId)).toEqual([created.presetId])

    const renamed = await svc.update(ws, created.presetId, { name: "Auth headers" })
    expect(renamed.name).toBe("Auth headers")

    await svc.delete(ws, created.presetId)
    expect((await svc.list(ws)).total).toBe(0)
  })

  it("hides another workspace's preset as not_found on update and delete", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const svc = service()
    const foreign = await svc.create(wsB, { name: "Foreign", nodeType: "delay", config: { duration: 10 } })

    expect((await svc.list(wsA)).total).toBe(0)
    await expect(svc.update(wsA, foreign.presetId, { name: "Stolen" })).rejects.toMatchObject({ code: "not_found" })
    await expect(svc.delete(wsA, foreign.presetId)).rejects.toMatchObject({ code: "not_found" })
  })

  it("rejects a config the node type would not accept", async () => {
    const ws = seedWorkspace("a")
    const svc = service()

    // `url` is an http-request field; DelayNodeDataSchema is strict.
    await expect(
      svc.create(ws, { name: "Bad", nodeType: "delay", config: { url: "https://api.test" } }),
    ).rejects.toMatchObject({ code: "validation" })

    // Same guard on update, including a nodeType-only patch that would strand
    // an http-request config on a delay preset.
    const httpPreset = await svc.create(ws, {
      name: "Fetch",
      nodeType: "http-request",
      config: { url: "https://api.test" },
    })
    await expect(svc.update(ws, httpPreset.presetId, { nodeType: "delay" })).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("canonicalises a legacy string headers config instead of rejecting it", async () => {
    const ws = seedWorkspace("a")
    const created = await service().create(ws, {
      name: "Legacy",
      nodeType: "http-request",
      config: { headers: "Accept: application/json" } as never,
    })

    expect(created.config).toEqual({ headers: [{ key: "Accept", value: "application/json" }] })
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
    const collection = collections.create({
      workspaceId: wsA,
      name: "Col",
      color: "#123456",
      continueOnFail: false,
    })
    const workflow = workflows.create({
      workspaceId: wsA,
      name: "WF",
      collectionId: collection.collectionId,
      selectedEnvironmentId: env.environmentId,
      variables: { token: "plaintext-token", url: "{{secrets.MY_KEY}}" },
      tags: ["smoke"],
      nodes: [
        { nodeId: "start", type: "start", position: { x: 0, y: 0 }, config: {} },
        { nodeId: "end", type: "end", position: { x: 200, y: 0 }, config: {} },
      ],
      edges: [{ edgeId: "start-end", source: "start", target: "end" }],
      nodeTemplates: [{ name: "Reusable request", type: "http-request" }],
    })
    collections.update(collection.collectionId, {
      workflowOrder: [{ workflowId: workflow.workflowId, order: 0, enabled: false, continueOnFail: false }],
    })

    const bundle = await exportService().exportProject(wsA, collection.collectionId)

    // Format + sanitization invariants.
    expect(bundle.schemaVersion).toBe("2.0")
    expect(bundle.type).toBe("awecollection")
    expect(bundle.project.continueOnFail).toBe(false)
    expect(bundle.project.workflowOrder).toEqual([
      { workflowId: workflow.workflowId, order: 0, enabled: false, continueOnFail: false },
    ])
    expect(bundle.workflows[0]?.nodes).toHaveLength(2)
    expect(bundle.workflows[0]?.edges).toHaveLength(1)
    expect(bundle.workflows[0]?.nodeTemplates).toEqual([{ name: "Reusable request", type: "http-request" }])
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
    const importedWorkflow = workflows.listByCollection(wsB, project2.collectionId).items[0]!
    expect(project2.workflowCount).toBe(1)
    expect(project2.continueOnFail).toBe(false)
    expect(project2.workflowOrder).toEqual([
      { workflowId: importedWorkflow.workflowId, order: 0, enabled: false, continueOnFail: false },
    ])
    expect(importedWorkflow.nodes).toHaveLength(2)
    expect(importedWorkflow.edges).toHaveLength(1)
    expect(importedWorkflow.nodeTemplates).toEqual([{ name: "Reusable request", type: "http-request" }])
    const bundle2 = await exportService().exportProject(wsB, project2.collectionId)

    expect(bundle2.workflows[0]?.variables).toEqual(bundle.workflows[0]?.variables)
    expect(bundle2.workflows[0]?.name).toBe(bundle.workflows[0]?.name)
    expect(bundle2.workflows[0]?.tags).toEqual(bundle.workflows[0]?.tags)
    expect(bundle2.secretReferences.map((r) => r.name).sort()).toEqual(
      bundle.secretReferences.map((r) => r.name).sort(),
    )
  })

  it("can omit environments while retaining a clear unmapped reference warning on import", async () => {
    const wsA = seedWorkspace("a")
    const env = environments.create({ workspaceId: wsA, name: "Env" })
    const collection = collections.create({ workspaceId: wsA, name: "Col" })
    workflows.create({
      workspaceId: wsA,
      name: "WF",
      collectionId: collection.collectionId,
      selectedEnvironmentId: env.environmentId,
    })

    const bundle = await exportService().exportProject(wsA, collection.collectionId, false)
    expect(bundle.environments).toEqual([])

    const result = await exportService().importProject(seedWorkspace("b"), bundle)
    expect(result.environmentCount).toBe(0)
    expect(result.warnings.some((warning) => warning.includes("could not be mapped"))).toBe(true)
  })

  it("can merge imported workflows into an explicitly selected project", async () => {
    const sourceWorkspace = seedWorkspace("source")
    const sourceProject = collections.create({ workspaceId: sourceWorkspace, name: "Source" })
    workflows.create({ workspaceId: sourceWorkspace, name: "Imported", collectionId: sourceProject.collectionId })
    const bundle = await exportService().exportProject(sourceWorkspace, sourceProject.collectionId)

    const targetWorkspace = seedWorkspace("target")
    const targetProject = collections.create({ workspaceId: targetWorkspace, name: "Target" })
    const existingWorkflow = workflows.create({
      workspaceId: targetWorkspace,
      name: "Existing",
      collectionId: targetProject.collectionId,
    })
    collections.update(targetProject.collectionId, {
      workflowCount: 1,
      workflowOrder: [{
        workflowId: existingWorkflow.workflowId,
        order: 0,
        enabled: true,
        continueOnFail: true,
      }],
    })

    const result = await exportService().importProject(targetWorkspace, bundle, {
      targetProjectId: targetProject.collectionId,
    })

    expect(result.projectId).toBe(targetProject.collectionId)
    expect(result.workflowCount).toBe(1)
    const merged = collections.getById(targetProject.collectionId)!
    expect(merged.name).toBe("Target")
    expect(merged.workflowCount).toBe(2)
    expect(merged.workflowOrder).toHaveLength(2)
    expect(workflows.listByCollection(targetWorkspace, targetProject.collectionId).total).toBe(2)
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
