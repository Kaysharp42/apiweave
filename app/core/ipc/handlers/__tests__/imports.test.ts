import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../../db"
import type { InitializedDatabase } from "../../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  RunRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../../repositories"
import { LocalOwnerProvider } from "../../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../../../services/scope_resolver"
import { WorkspaceService } from "../../../services/workspace_service"
import { CollectionService } from "../../../services/collection_service"
import { WorkflowService } from "../../../services/workflow_service"
import { EnvironmentService } from "../../../services/environment_service"
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
    const meta: SecretMetadata = { secretId: this.key(input.scopeType, input.scopeId, input.name), name: input.name, scopeType: input.scopeType, scopeId: input.scopeId, keyId: input.keyId, ...(input.label !== undefined ? { label: input.label } : {}) }
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

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
  const runs = new RunRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  const permissions = new LocalOwnerProvider()
  const sync = new LocalOnlySyncProvider()
  const secretStore = new FakeSecretStore()

  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, sync, scopeResolver),
    collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
    workflows: new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments),
    environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
    runs: new RunService(runs, sync, permissions, scopeResolver),
    secrets: new SecretService(secretStore, sync, permissions, scopeResolver, new Uint8Array(32)),
    projects: new ProjectExportService(collections, workflows, environments, sync, permissions, scopeResolver, secretStore, () => "2026-01-01T00:00:00.000Z"),
    imports: new ImportService(workflows, environments, collections, sync, permissions, scopeResolver),
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
