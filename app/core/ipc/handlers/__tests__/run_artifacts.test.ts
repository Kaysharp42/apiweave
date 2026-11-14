import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
  RunArtifactRepository,
  RunRepository,
  SecretRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../../repositories"
import { ScopeResolver, type ScopeExistence } from "../../../services/scope_resolver"
import { WorkspaceService } from "../../../services/workspace_service"
import { CollectionService } from "../../../services/collection_service"
import { WorkflowService } from "../../../services/workflow_service"
import { WorkflowAnalysisService } from "../../../services/workflow_analysis_service"
import { AssertionAuthoringService } from "../../../services/assertion_authoring_service"
import { EnvironmentService } from "../../../services/environment_service"
import { NodePresetService } from "../../../services/node_preset_service"
import { RunService } from "../../../services/run_service"
import { SecretService } from "../../../services/secret_service"
import { ProjectExportService } from "../../../services/project_export_service"
import { ImportService } from "../../../services/import_service"
import type { RunArtifact } from "@shared/types/RunArtifact"
import { IpcRouter } from "../../router"
import { registerAllHandlers, type HandlerDeps } from ".."

let db: InitializedDatabase
let router: IpcRouter
let runs: RunRepository
let artifacts: RunArtifactRepository

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
  runs = new RunRepository(db.kvStore)
  artifacts = new RunArtifactRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const nodePresets = new NodePresetRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const secretStore = new SecretRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  const workflowService = new WorkflowService(workflows, scopeResolver, collections, environments)
  const runService = new RunService(runs, scopeResolver)
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, workflows, scopeResolver),
    collections: new CollectionService(collections, workflows, scopeResolver),
    workflows: workflowService,
    workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
    assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
    environments: new EnvironmentService(environments, scopeResolver),
    nodePresets: new NodePresetService(nodePresets, scopeResolver),
    runs: runService,
    runArtifacts: artifacts,
    secrets: new SecretService(secretStore, scopeResolver, environments, new Uint8Array(32)),
    projects: new ProjectExportService(
      collections,
      workflows,
      environments,
      scopeResolver,
      secretStore,
      () => "2026-01-01T00:00:00.000Z",
    ),
    imports: new ImportService(workflows, environments, collections, scopeResolver),
  }
  router = new IpcRouter()
  registerAllHandlers(router, deps)
})

afterEach(() => db.close())

async function ok<T = unknown>(domain: string, action: string, payload?: unknown): Promise<T> {
  const res = await router.dispatch({ domain, action, payload })
  if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res.error)}`)
  return res.data as T
}

async function seedRun(): Promise<{ workspaceId: string; runId: string; artifactId: string }> {
  const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme", isPersonal: false })
  const workflow = await ok<{ workflowId: string }>("workflows", "create", { workspaceId: workspace.workspaceId, name: "wf" })
  const run = runs.create({ workspaceId: workspace.workspaceId, workflowId: workflow.workflowId })
  const artifactId = artifacts.save({
    runId: run.runId,
    nodeId: "browser-1",
    kind: "screenshot",
    mime: "image/jpeg",
    body: JPEG,
  })
  return { workspaceId: workspace.workspaceId, runId: run.runId, artifactId }
}

describe("runs.getArtifact", () => {
  it("returns the stored screenshot as base64 with its mime type", async () => {
    const { workspaceId, runId, artifactId } = await seedRun()

    const artifact = await ok<RunArtifact>("runs", "getArtifact", { workspaceId, runId, artifactId })
    expect(artifact.mime).toBe("image/jpeg")
    expect(Buffer.from(artifact.base64, "base64")).toEqual(JPEG)
  })

  it("refuses a run that belongs to another workspace, like runs.get", async () => {
    const { runId, artifactId } = await seedRun()
    const other = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Other", isPersonal: false })

    const foreign = await router.dispatch({
      domain: "runs",
      action: "getArtifact",
      payload: { workspaceId: other.workspaceId, runId, artifactId },
    })
    expect(foreign.ok ? null : foreign.error.code).toBe("not_found")
  })

  it("is not_found for an artifact id the run does not own", async () => {
    const { workspaceId, runId } = await seedRun()

    const missing = await router.dispatch({
      domain: "runs",
      action: "getArtifact",
      payload: { workspaceId, runId, artifactId: "not-an-id" },
    })
    expect(missing.ok ? null : missing.error.code).toBe("not_found")
  })
})
