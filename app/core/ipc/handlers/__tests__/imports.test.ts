import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../../db"
import type { InitializedDatabase } from "../../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  NodePresetRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../../repositories"
import { LocalOwnerProvider } from "../../../auth/LocalOwnerProvider"
import { ScopeResolver, type ScopeExistence } from "../../../services/scope_resolver"
import { WorkspaceService } from "../../../services/workspace_service"
import { CollectionService } from "../../../services/collection_service"
import { WorkflowService } from "../../../services/workflow_service"
import { WorkflowAnalysisService } from "../../../services/workflow_analysis_service"
import { AssertionAuthoringService } from "../../../services/assertion_authoring_service"
import { EnvironmentService } from "../../../services/environment_service"
import { NodePresetService } from "../../../services/node_preset_service"
import { RunService } from "../../../services/run_service"
import { SecretService, type SecretWriteStore, type SecretUpsert } from "../../../services/secret_service"
import { ProjectExportService } from "../../../services/project_export_service"
import { ImportService } from "../../../services/import_service"
import type { SecretMetadata, SecretScopeType } from "../../../secrets/scoped_secret_resolver"
import { IpcRouter } from "../../router"
import { registerAllHandlers, type HandlerDeps } from ".."

class FakeSecretStore implements SecretWriteStore {
  private readonly rows = new Map<string, { meta: SecretMetadata; sealed: Uint8Array }>()
  private key(t: string, s: string, n: string): string { return `${t}/${s}/${n}` }
  put(input: SecretUpsert): SecretMetadata {
    const meta: SecretMetadata = { secretId: this.key(input.scopeType, input.scopeId, input.name), name: input.name, scopeType: input.scopeType, scopeId: input.scopeId, keyId: input.keyId, createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z", ...(input.label !== undefined ? { label: input.label } : {}) }
    this.rows.set(meta.secretId, { meta, sealed: input.sealed })
    return meta
  }
  remove(t: SecretScopeType, s: string, n: string): boolean { return this.rows.delete(this.key(t, s, n)) }
  listByScope(t: SecretScopeType, s: string): SecretMetadata[] { return [...this.rows.values()].filter((r) => r.meta.scopeType === t && r.meta.scopeId === s).map((r) => r.meta) }
  getByScopeAndName(t: SecretScopeType, s: string, n: string): SecretMetadata | null { return this.rows.get(this.key(t, s, n))?.meta ?? null }
}

let db: InitializedDatabase
let router: IpcRouter
let wsId: string
let workflows: WorkflowRepository

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  const runs = new RunRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const nodePresets = new NodePresetRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  const permissions = new LocalOwnerProvider()
  const secretStore = new FakeSecretStore()

  const workflowService = new WorkflowService(workflows, permissions, scopeResolver, collections, environments)
  const runService = new RunService(runs, permissions, scopeResolver)
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, workflows, scopeResolver),
    collections: new CollectionService(collections, workflows, permissions, scopeResolver),
    workflows: workflowService,
    workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
    assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
    environments: new EnvironmentService(environments, permissions, scopeResolver),
    nodePresets: new NodePresetService(nodePresets, permissions, scopeResolver),
    runs: runService,
    secrets: new SecretService(secretStore, permissions, scopeResolver, environments, new Uint8Array(32)),
    projects: new ProjectExportService(collections, workflows, environments, permissions, scopeResolver, secretStore, () => "2026-01-01T00:00:00.000Z"),
    imports: new ImportService(workflows, environments, collections, permissions, scopeResolver),
  }
  router = new IpcRouter()
  registerAllHandlers(router, deps)
  wsId = workspaces.create({ name: "test", slug: "test" }).workspaceId
})

afterEach(() => db.close())

async function ok<T = unknown>(domain: string, action: string, payload?: unknown): Promise<T> {
  const res = await router.dispatch({ domain, action, payload })
  if (!res.ok) throw new Error(`expected ok, got ${JSON.stringify(res.error)}`)
  return res.data as T
}

describe("IPC import handlers — workflow bundle", () => {
  it("imports a bundle with {workflow,environments,secretReferences,metadata} shape", async () => {
    const result = await ok<{ workflowId: string; name: string }>("workflows", "import", {
      workspaceId: wsId,
      bundle: {
        workflow: {
          name: "Test Bundle",
          nodes: [{ nodeId: "n1", type: "http-request", label: "req", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://a.com", headers: "", queryParams: "", cookies: "", timeout: 30, followRedirects: true, extractors: {} } }],
          edges: [],
          variables: {},
        },
        environments: [],
        secretReferences: [],
        metadata: { exportedAt: "", workflowCount: 1, environmentCount: 0, secretReferenceCount: 0 },
      },
    })
    expect(result.workflowId).toBeTruthy()
    expect(result.name).toBe("Test Bundle")
  })

  it("dryRun validates without creating", async () => {
    const result = await ok<{ valid: boolean; stats: { nodes: number } }>("workflows", "dryRun", {
      workspaceId: wsId,
      bundle: {
        workflow: {
          name: "Test",
          nodes: [{ nodeId: "n1", type: "http-request", label: "r", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://a.com", headers: "", queryParams: "", cookies: "", timeout: 30, followRedirects: true, extractors: {} } }],
          edges: [],
          variables: {},
        },
        environments: [],
        secretReferences: [],
        metadata: { exportedAt: "", workflowCount: 1, environmentCount: 0, secretReferenceCount: 0 },
      },
    })
    expect(result.valid).toBe(true)
    expect(result.stats.nodes).toBe(1)
  })
})

describe("IPC import handlers — OpenAPI", () => {
  const spec = JSON.stringify({
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0" },
    paths: { "/items": { get: { operationId: "list" } } },
  })

  it("parses OpenAPI spec", async () => {
    const result = await ok<{ nodes: { type: string }[] }>("workflows", "importOpenapi", {
      workspaceId: wsId,
      spec,
    })
    expect(result.nodes.length).toBeGreaterThanOrEqual(1)
  })

  it("preview returns metadata", async () => {
    const result = await ok<{ stats: { apiTitle: string } }>("workflows", "importOpenapi", {
      workspaceId: wsId,
      spec,
      dryRun: true,
    })
    expect(result.stats.apiTitle).toBe("Test")
  })
})

describe("IPC import handlers — HAR", () => {
  it("parses HAR data", async () => {
    const result = await ok<{ nodes: { type: string }[] }>("workflows", "importHar", {
      workspaceId: wsId,
      data: {
        log: {
          entries: [
            { request: { method: "GET", url: "https://a.com", headers: [], cookies: [], queryString: [] }, response: { status: 200 } },
          ],
        },
      },
    })
    expect(result.nodes.length).toBeGreaterThanOrEqual(1)
  })

  it("dryRun returns sanitized stats", async () => {
    const result = await ok<{ stats: { totalEntries: number } }>("workflows", "importHar", {
      workspaceId: wsId,
      data: { log: { entries: [{ request: { method: "GET", url: "https://a.com" } }] } },
      dryRun: true,
    })
    expect(result.stats.totalEntries).toBe(1)
  })
})

describe("IPC import handlers — cURL", () => {
  it("non-dry-run creates a workflow and returns workflowId", async () => {
    const result = await ok<{ workflowId: string }>("workflows", "importCurl", {
      workspaceId: wsId,
      curlCommand: 'curl "https://api.example.com/users"',
    })
    expect(result.workflowId).toBeTruthy()
  })

  it("parseOnly returns the parsed nodes without creating a workflow", async () => {
    const before = workflows.listByWorkspace(wsId).total
    const result = await ok<{ nodes: { type: string }[] }>("workflows", "importCurl", {
      workspaceId: wsId,
      curlCommand: 'curl "https://a.com"\ncurl "https://b.com"',
      parseOnly: true,
    })
    expect(result.nodes.filter((node) => node.type === "http-request")).toHaveLength(2)
    expect(workflows.listByWorkspace(wsId).total).toBe(before)
  })

  it("dryRun returns stats without creating", async () => {
    const result = await ok<{ stats: { totalRequests: number } }>("workflows", "importCurl", {
      workspaceId: wsId,
      curlCommand: 'curl "https://a.com"\ncurl "https://b.com"',
      dryRun: true,
    })
    expect(result.stats.totalRequests).toBe(2)
  })
})

describe("IPC import handlers — saveTemplates", () => {
  it("saves templates to a workflow", async () => {
    const imported = await ok<{ workflowId: string }>("workflows", "import", {
      workspaceId: wsId,
      bundle: {
        workflow: { name: "WF", nodes: [], edges: [], variables: {} },
        environments: [],
        secretReferences: [],
        metadata: { exportedAt: "", workflowCount: 1, environmentCount: 0, secretReferenceCount: 0 },
      },
    })

    const updated = await ok<{ nodeTemplates: unknown[] }>("workflows", "saveTemplates", {
      workspaceId: wsId,
      workflowId: imported.workflowId,
      templates: [
        { nodeId: "t1", type: "http-request", label: "T", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://t.com", headers: [], queryParams: [], cookies: [], timeout: 30, followRedirects: true, extractors: {} } },
      ],
    })
    expect(updated.nodeTemplates.length).toBe(1)
  })
})

describe("IPC import handlers — Postman", () => {
  const fixture = (name: string): unknown =>
    JSON.parse(fs.readFileSync(path.join(__dirname, "../../../services/__tests__/__fixtures__", name), "utf8"))

  it("previews without writing, then imports into a new project and lists the secrets to create", async () => {
    const payload = { workspaceId: wsId, collection: fixture("shop.postman_collection.json"), environment: fixture("shop.postman_environment.json") }
    const preview = await ok<{ workflows: unknown[]; requiredSecrets: { name: string }[] }>("projects", "previewPostman", payload)
    expect(preview.workflows).toHaveLength(5)
    expect(preview.requiredSecrets).toHaveLength(5)
    expect(await ok<{ total: number }>("projects", "list", { workspaceId: wsId })).toMatchObject({ total: 0 })

    const result = await ok<{ projectId: string; workflowCount: number; missingSecrets: string[]; warnings: string[] }>(
      "projects", "importPostman", { ...payload, projectName: "Shop (migrated)" },
    )
    expect(result.workflowCount).toBe(5)
    expect(result.missingSecrets).toHaveLength(5)
    expect(result.warnings.some((warning) => warning.startsWith("Secret '"))).toBe(false)
    const project = await ok<{ name: string }>("projects", "get", { workspaceId: wsId, collectionId: result.projectId })
    expect(project.name).toBe("Shop (migrated)")
  })

  it("rejects a Collection v1 file", async () => {
    const res = await router.dispatch({
      domain: "projects",
      action: "previewPostman",
      payload: { workspaceId: wsId, collection: { id: "x", name: "Old", order: [], requests: [] } },
    })
    expect(res.ok).toBe(false)
    expect(JSON.stringify(res)).toContain("Collection v1")
  })
})
