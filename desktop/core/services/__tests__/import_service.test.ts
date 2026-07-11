import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { ImportService } from "../import_service"
import type { WorkflowBundle } from "../import_service"

let db: InitializedDatabase
let service: ImportService
let wsId: string

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  const scopeResolver = new ScopeResolver(existence)
  const permissions = new LocalOwnerProvider()
  const sync = new LocalOnlySyncProvider()
  service = new ImportService(workflows, environments, collections, sync, permissions, scopeResolver)
  wsId = workspaces.create({ name: "test", slug: "test" }).workspaceId
})

afterEach(() => db.close())

describe("ImportService — workflow bundle export/import", () => {
  it("exports a bundle with {workflow, environments, secretReferences, metadata} shape", async () => {
    const wf = await service.importWorkflow(wsId, {
      workflow: {
        name: "Test WF",
        nodes: [{ nodeId: "n1", type: "http-request", label: "req", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://a.com", headers: "", queryParams: "", cookies: "", timeout: 30, followRedirects: true, extractors: {} } }],
        edges: [],
        variables: {},
      },
      environments: [],
      secretReferences: [],
      metadata: { exportedAt: "", workflowCount: 1, environmentCount: 0, secretReferenceCount: 0 },
    }, false, true)

    const bundle = await service.exportWorkflow(wsId, wf.workflowId, false)
    expect(bundle).toHaveProperty("workflow")
    expect(bundle).toHaveProperty("environments")
    expect(bundle).toHaveProperty("secretReferences")
    expect(bundle).toHaveProperty("metadata")
    expect(bundle.workflow.name).toBe("Test WF")
  })

  it("imports a bundle and creates environment when createMissingEnvironments=true", async () => {
    const bundle: WorkflowBundle = {
      workflow: {
        name: "Imported",
        nodes: [{ nodeId: "n1", type: "http-request", label: "req", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://a.com", headers: "", queryParams: "", cookies: "", timeout: 30, followRedirects: true, extractors: {} } }],
        edges: [],
        variables: {},
        selectedEnvironmentId: "env-1",
      },
      environments: [{
        environmentId: "env-1",
        name: "Bundled Env",
        description: null,
        variables: { base: "https://api.test.com" },
        swaggerDocUrl: null,
      }],
      secretReferences: [],
      metadata: { exportedAt: "", workflowCount: 1, environmentCount: 1, secretReferenceCount: 0 },
    }

    const result = await service.importWorkflow(wsId, bundle, true, true)
    expect(result.workflowId).toBeTruthy()
    expect(result.name).toBe("Imported")
  })

  it("dryRun validates a bundle without creating anything", async () => {
    const bundle: WorkflowBundle = {
      workflow: {
        name: "Test",
        nodes: [{ nodeId: "n1", type: "http-request", label: "req", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://a.com", headers: "", queryParams: "", cookies: "", timeout: 30, followRedirects: true, extractors: {} } }],
        edges: [],
        variables: { x: "y" },
      },
      environments: [],
      secretReferences: [],
      metadata: { exportedAt: "", workflowCount: 1, environmentCount: 0, secretReferenceCount: 0 },
    }
    const result = await service.dryRunWorkflow(wsId, bundle)
    expect(result.valid).toBe(true)
    expect(result.stats.nodes).toBe(1)
    expect(result.stats.variables).toBe(1)
  })

  it("rejects bundles with forbidden secret fields", async () => {
    const bundle = {
      workflow: {
        name: "Bad",
        nodes: [],
        edges: [],
        variables: { ciphertext: "evil" },
      },
      environments: [],
      secretReferences: [],
      metadata: { exportedAt: "", workflowCount: 1, environmentCount: 0, secretReferenceCount: 0 },
    }
    await expect(
      service.importWorkflow(wsId, bundle as unknown as WorkflowBundle, false, true),
    ).rejects.toThrow()
  })
})

describe("ImportService — cURL", () => {
  it("parses curl and creates a workflow with start→http→end chain", async () => {
    const wf = await service.importCurlAsWorkflow(wsId, 'curl "https://api.example.com/users"')
    expect(wf.workflowId).toBeTruthy()
    expect(wf.nodes.length).toBe(3)
    expect(wf.nodes[0]!.type).toBe("start")
    expect(wf.nodes[1]!.type).toBe("http-request")
    expect(wf.nodes[2]!.type).toBe("end")
    expect(wf.edges.length).toBe(2)
  })

  it("dryRun returns stats without creating", () => {
    const result = service.dryRunCurl('curl "https://a.com"\ncurl "https://b.com"')
    expect(result.stats.totalRequests).toBe(2)
  })

  it("validates workflowId belongs to workspace", async () => {
    await expect(
      service.importCurlAsWorkflow(wsId, 'curl "https://a.com"', { workflowId: "nonexistent" }),
    ).rejects.toThrow()
  })

  it("validates collectionId belongs to workspace", async () => {
    await expect(
      service.importCurlAsWorkflow(wsId, 'curl "https://a.com"', { collectionId: "nonexistent" }),
    ).rejects.toThrow()
  })
})

describe("ImportService — HAR", () => {
  it("parses HAR data with start/end chain", () => {
    const har = {
      log: {
        entries: [
          { request: { method: "GET", url: "https://a.com", headers: [], cookies: [], queryString: [] }, response: { status: 200 }, time: 10 },
        ],
      },
    }
    const result = service.parseHar(har)
    expect(result.nodes.length).toBe(3)
    expect(result.edges.length).toBe(2)
  })

  it("dryRun produces sanitized preview", () => {
    const har = {
      log: {
        entries: [
          { request: { method: "GET", url: "https://a.com", headers: [{ name: "Authorization", value: "Bearer secret" }] }, time: 10 },
        ],
      },
    }
    const result = service.dryRunHar(har, { sanitize: true })
    expect(result.stats.totalEntries).toBe(1)
    expect(result.preview[0]!.headers).toContain("[FILTERED]")
  })
})

describe("ImportService — OpenAPI", () => {
  const spec = JSON.stringify({
    openapi: "3.0.0",
    info: { title: "Test", version: "1.0" },
    paths: { "/items": { get: { operationId: "list" } } },
  })

  it("parses OpenAPI spec text", () => {
    const result = service.parseOpenApi(spec)
    expect(result.nodes.filter((n) => n.type === "http-request").length).toBe(1)
  })

  it("preview returns metadata", () => {
    const result = service.previewOpenApi(spec)
    expect(result.stats.apiTitle).toBe("Test")
    expect(result.stats.totalEndpoints).toBe(1)
  })
})
