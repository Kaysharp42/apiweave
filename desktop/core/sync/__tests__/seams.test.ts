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
import { LocalOnlySyncProvider } from "../LocalOnlySyncProvider"
import type { SyncProvider } from "../SyncProvider"
import { ScopeResolver, type ScopeExistence } from "../../services/scope_resolver"
import { CollectionService } from "../../services/collection_service"
import { ProjectExportService } from "../../services/project_export_service"

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let environments: EnvironmentRepository
let collections: CollectionRepository
let scopeResolver: ScopeResolver
const permissions = new LocalOwnerProvider()
const sync = new LocalOnlySyncProvider()

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
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

// ─── 1. SyncProvider seam ────────────────────────────────────────────────────

describe("SyncProvider seam — LocalOnlySyncProvider (QA: task-7-seams)", () => {
  it("pull() and push() resolve without error and touch no remote", async () => {
    const provider: SyncProvider = new LocalOnlySyncProvider()
    await expect(provider.pull()).resolves.toBeUndefined()
    await expect(provider.push()).resolves.toBeUndefined()
  })

  it("exposes exactly the pull/push surface a cloud provider must conform to", () => {
    const provider: SyncProvider = new LocalOnlySyncProvider()
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(provider)).filter(
      (m) => m !== "constructor",
    )
    expect(methods.sort()).toEqual(["pull", "push"])
  })
})

// ─── 2. Workspace origin / syncMode ─────────────────────────────────────────

describe("Workspace origin + syncMode defaults and update (QA: task-7-seams)", () => {
  it("fresh workspace defaults to origin='local', syncMode='none'", () => {
    const ws = workspaces.create({ name: "Fresh", slug: "fresh" })
    expect(ws.origin).toBe("local")
    expect(ws.syncMode).toBe("none")
  })

  it("updates origin to 'cloud' and syncMode to 'bi-directional' and preserves them", () => {
    const ws = workspaces.create({ name: "Migrate", slug: "migrate" })
    const updated = workspaces.update(ws.workspaceId, { origin: "cloud", syncMode: "bi-directional" })
    expect(updated).toBeDefined()
    expect(updated!.origin).toBe("cloud")
    expect(updated!.syncMode).toBe("bi-directional")

    // Round-trip through getById to confirm persistence.
    const fetched = workspaces.getById(ws.workspaceId)
    expect(fetched?.origin).toBe("cloud")
    expect(fetched?.syncMode).toBe("bi-directional")
  })
})

// ─── 3. Project === Collection ───────────────────────────────────────────────

describe("Project === Collection alias (QA: task-7-seams)", () => {
  it("collectionId serves as projectId when no explicit projectId is set", async () => {
    const ws = seedWorkspace("proj-alias")
    const collectionService = new CollectionService(collections, workflows, sync, permissions, scopeResolver)

    const collection = await collectionService.create(ws, { name: "My Project" })

    // The collection IS the project — retrieve by collectionId.
    const fetched = await collectionService.get(ws, collection.collectionId)
    expect(fetched.collectionId).toBe(collection.collectionId)

    // In the export bundle, project.projectId resolves to collectionId.
    const exportService = new ProjectExportService(
      collections,
      workflows,
      environments,
      sync,
      permissions,
      scopeResolver,
      undefined,
      () => "2026-01-01T00:00:00.000Z",
    )
    const bundle = await exportService.exportProject(ws, collection.collectionId)
    expect(bundle.project.projectId).toBe(collection.collectionId)
  })

  it("explicit projectId is preserved on the collection row", async () => {
    const ws = seedWorkspace("explicit-proj")
    const collection = collections.create({ workspaceId: ws, name: "Legacy", projectId: "p1" })
    expect(collection.projectId).toBe("p1")

    const fetched = collections.getById(collection.collectionId)
    expect(fetched?.projectId).toBe("p1")
  })
})

// ─── 4. Export excludes secrets (QA: task-7-secret-boundary) ─────────────────

describe("Export excludes secret plaintext (QA: task-7-secret-boundary)", () => {
  it("produces a bundle with no plaintext secret, no sealed blob, and secretReferences populated", async () => {
    const ws = seedWorkspace("export-secrets")
    const env = environments.create({
      workspaceId: ws,
      name: "Prod",
      variables: { API_KEY: "SUPER_SECRET_VALUE", BASE_URL: "https://api.example.com" },
    })
    const collection = collections.create({ workspaceId: ws, name: "Suite" })
    workflows.create({
      workspaceId: ws,
      name: "WF",
      collectionId: collection.collectionId,
      selectedEnvironmentId: env.environmentId,
      variables: { token: "plaintext-token", url: "{{secrets.API_KEY}}" },
    })

    const exportService = new ProjectExportService(
      collections,
      workflows,
      environments,
      sync,
      permissions,
      scopeResolver,
      undefined,
      () => "2026-01-01T00:00:00.000Z",
    )
    const bundle = await exportService.exportProject(ws, collection.collectionId)

    // Secret values are redacted.
    const serialized = JSON.stringify(bundle)
    expect(serialized).not.toContain("SUPER_SECRET_VALUE")
    expect(serialized).not.toContain("plaintext-token")

    // No sealed-blob / ciphertext fields anywhere.
    expect(serialized).not.toContain("ciphertext")
    expect(serialized).not.toContain("privateKey")
    expect(serialized).not.toContain("encryptedValue")

    // Secret references are present.
    expect(bundle.secretReferences.length).toBeGreaterThanOrEqual(1)
    const refNames = bundle.secretReferences.map((r) => r.name)
    expect(refNames).toContain("API_KEY")

    // Non-secret variables pass through unchanged.
    expect(bundle.environments[0]?.variables).toEqual({
      API_KEY: "<SECRET>",
      BASE_URL: "https://api.example.com",
    })
  })
})
