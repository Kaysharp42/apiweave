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
import { LocalOnlySyncProvider } from "../../../sync/LocalOnlySyncProvider"
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

/** In-memory write-only secret store: keeps sealed bytes private, returns metadata only. */
class FakeSecretStore implements SecretWriteStore {
  private readonly rows = new Map<string, { meta: SecretMetadata; sealed: Uint8Array }>()
  private key(t: string, s: string, n: string): string {
    return `${t}/${s}/${n}`
  }
  put(input: SecretUpsert): SecretMetadata {
    const meta: SecretMetadata = {
      secretId: this.key(input.scopeType, input.scopeId, input.name),
      name: input.name,
      scopeType: input.scopeType,
      scopeId: input.scopeId,
      keyId: input.keyId,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
      ...(input.label !== undefined ? { label: input.label } : {}),
    }
    this.rows.set(meta.secretId, { meta, sealed: input.sealed })
    return meta
  }
  remove(t: SecretScopeType, s: string, n: string): boolean {
    return this.rows.delete(this.key(t, s, n))
  }
  listByScope(t: SecretScopeType, s: string): SecretMetadata[] {
    return [...this.rows.values()].filter((r) => r.meta.scopeType === t && r.meta.scopeId === s).map((r) => r.meta)
  }
  getByScopeAndName(t: SecretScopeType, s: string, n: string): SecretMetadata | null {
    return this.rows.get(this.key(t, s, n))?.meta ?? null
  }
}

let db: InitializedDatabase
let router: IpcRouter
let secretStore: FakeSecretStore
let workspaces: WorkspaceRepository

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
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
  const sync = new LocalOnlySyncProvider()
  secretStore = new FakeSecretStore()

  const workflowService = new WorkflowService(workflows, sync, permissions, scopeResolver, collections, environments)
  const runService = new RunService(runs, sync, permissions, scopeResolver)
  const deps: HandlerDeps = {
    workspaces: new WorkspaceService(workspaces, sync, scopeResolver),
    collections: new CollectionService(collections, workflows, sync, permissions, scopeResolver),
    workflows: workflowService,
    workflowAnalysis: new WorkflowAnalysisService(workflowService, runService),
    assertionAuthoring: new AssertionAuthoringService(workflowService, runService),
    environments: new EnvironmentService(environments, sync, permissions, scopeResolver),
    nodePresets: new NodePresetService(nodePresets, permissions, scopeResolver),
    runs: runService,
    secrets: new SecretService(secretStore, sync, permissions, scopeResolver, environments, new Uint8Array(32)),
    projects: new ProjectExportService(
      collections,
      workflows,
      environments,
      sync,
      permissions,
      scopeResolver,
      secretStore,
      () => "2026-01-01T00:00:00.000Z",
    ),
    imports: new ImportService(workflows, environments, collections, sync, permissions, scopeResolver),
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

describe("IPC handlers — dispatch envelope + authorize + validate (QA: task-13-handler-parity)", () => {
  it("round-trips workspace → workflow create/get/list through the router", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const created = await ok<{ workflowId: string; name: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "demo",
    })
    expect(created.name).toBe("demo")

    const fetched = await ok<{ workflowId: string }>("workflows", "get", {
      workspaceId: workspace.workspaceId,
      workflowId: created.workflowId,
    })
    expect(fetched.workflowId).toBe(created.workflowId)

    const list = await ok<{ items: { workflowId: string }[]; total: number }>("workflows", "list", {
      workspaceId: workspace.workspaceId,
    })
    expect(list.items.map((w) => w.workflowId)).toContain(created.workflowId)
    expect(list.total).toBeGreaterThanOrEqual(1)
  })

  it("returns not_found for an unknown workspace (existence-hiding, never denied)", async () => {
    const res = await router.dispatch({
      domain: "workflows",
      action: "get",
      payload: { workspaceId: "ws-nope", workflowId: "w1" },
    })
    expect(res).toMatchObject({ ok: false, error: { code: "not_found" } })
  })

  it("returns not_found for a missing domain.action", async () => {
    const res = await router.dispatch({ domain: "workflows", action: "teleport", payload: {} })
    expect(res).toMatchObject({ ok: false, error: { code: "not_found" } })
  })

  it("returns validation for a malformed payload", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    // Missing required `name`.
    const res = await router.dispatch({
      domain: "workflows",
      action: "create",
      payload: { workspaceId: workspace.workspaceId },
    })
    expect(res).toMatchObject({ ok: false, error: { code: "validation" } })
  })

  it("maps a delete-conflict to the conflict code", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const collection = await ok<{ collectionId: string }>("projects", "create", {
      workspaceId: workspace.workspaceId,
      name: "Col",
    })
    const workflow = await ok<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "wf",
    })
    await ok("projects", "addWorkflow", {
      workspaceId: workspace.workspaceId,
      collectionId: collection.collectionId,
      workflowId: workflow.workflowId,
    })
    const res = await router.dispatch({
      domain: "projects",
      action: "delete",
      payload: { workspaceId: workspace.workspaceId, collectionId: collection.collectionId },
    })
    expect(res).toMatchObject({ ok: false, error: { code: "conflict" } })
  })
})

describe("IPC handlers — nodePresets domain", () => {
  it("round-trips create/list/update/delete through the router", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const created = await ok<{ presetId: string; nodeType: string; config: Record<string, unknown> }>(
      "nodePresets",
      "create",
      {
        workspaceId: workspace.workspaceId,
        name: "Standard auth headers",
        nodeType: "http-request",
        config: { headers: [{ key: "Authorization", value: "Bearer {{secrets.TOKEN}}" }] },
      },
    )
    expect(created).toMatchObject({ nodeType: "http-request" })

    const listed = await ok<{ items: { presetId: string }[]; total: number }>("nodePresets", "list", {
      workspaceId: workspace.workspaceId,
    })
    expect(listed.total).toBe(1)
    expect(listed.items[0]?.presetId).toBe(created.presetId)

    const renamed = await ok<{ name: string }>("nodePresets", "update", {
      workspaceId: workspace.workspaceId,
      presetId: created.presetId,
      name: "Auth headers",
    })
    expect(renamed.name).toBe("Auth headers")

    expect(
      await ok("nodePresets", "delete", { workspaceId: workspace.workspaceId, presetId: created.presetId }),
    ).toBeNull()
    expect((await ok<{ total: number }>("nodePresets", "list", { workspaceId: workspace.workspaceId })).total).toBe(0)
  })

  it("accepts a legacy string headers config and stores it canonicalised", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const created = await ok<{ config: Record<string, unknown> }>("nodePresets", "create", {
      workspaceId: workspace.workspaceId,
      name: "Legacy",
      nodeType: "http-request",
      config: { headers: "Accept: application/json" },
    })
    expect(created.config).toEqual({ headers: [{ key: "Accept", value: "application/json" }] })
  })

  it("rejects an unknown node type and a config the node type would refuse", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })

    // `start` carries no config, so it is not a preset node type at all.
    expect(
      await router.dispatch({
        domain: "nodePresets",
        action: "create",
        payload: { workspaceId: workspace.workspaceId, name: "Nope", nodeType: "start" },
      }),
    ).toMatchObject({ ok: false, error: { code: "validation" } })

    expect(
      await router.dispatch({
        domain: "nodePresets",
        action: "create",
        payload: {
          workspaceId: workspace.workspaceId,
          name: "Nope",
          nodeType: "delay",
          config: { url: "https://api.test" },
        },
      }),
    ).toMatchObject({ ok: false, error: { code: "validation" } })
  })

  it("hides an unknown workspace as not_found", async () => {
    expect(
      await router.dispatch({
        domain: "nodePresets",
        action: "list",
        payload: { workspaceId: "ws-unknown" },
      }),
    ).toMatchObject({ ok: false, error: { code: "not_found" } })
  })
})

describe("IPC handlers — no secret plaintext in read responses (QA: task-13-handler-no-secret-leak)", () => {
  const PLAINTEXT = "super-secret-value-1234"

  it("returns a scope public key for write-only secret ingress", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })
    const publicKey = await ok<{ keyId: string; publicKey: string; algorithm: string }>("secrets", "publicKey", {
      workspaceId: workspace.workspaceId,
      scopeType: "workspace",
      scopeId: workspace.workspaceId,
    })

    expect(publicKey).toMatchObject({
      keyId: `sealed-box:workspace:${workspace.workspaceId}`,
      algorithm: "libsodium-sealed-box",
    })
    expect(Buffer.from(publicKey.publicKey, "base64")).toHaveLength(32)
  })

  it("workflows.get, environments.list, and secrets.list never surface secret plaintext or sealed bytes", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })

    // The secret value lives ONLY in the sealed store; a reference lives in the workflow.
    await ok("secrets", "set", {
      workspaceId: workspace.workspaceId,
      name: "TEST_KEY",
      scopeType: "workspace",
      scopeId: workspace.workspaceId,
      keyId: "k1",
      sealed: new TextEncoder().encode(PLAINTEXT),
    })
    const env = await ok<{ environmentId: string }>("environments", "create", {
      workspaceId: workspace.workspaceId,
      name: "Env",
      variables: { base: "http://api", token: "{{secrets.TEST_KEY}}" },
    })
    const workflow = await ok<{ workflowId: string }>("workflows", "create", {
      workspaceId: workspace.workspaceId,
      name: "wf",
      variables: { auth: "{{secrets.TEST_KEY}}" },
    })

    const got = await ok("workflows", "get", {
      workspaceId: workspace.workspaceId,
      workflowId: workflow.workflowId,
    })
    const envs = await ok("environments", "list", { workspaceId: workspace.workspaceId })
    const secrets = await ok("secrets", "list", {
      workspaceId: workspace.workspaceId,
      scopeType: "workspace",
      scopeId: workspace.workspaceId,
    })

    for (const payload of [got, envs, secrets]) {
      const serialized = JSON.stringify(payload)
      expect(serialized).not.toContain(PLAINTEXT)
    }
    // The reference placeholder DOES survive — it is not a secret value.
    expect(JSON.stringify(got)).toContain("{{secrets.TEST_KEY}}")
    // Metadata only: the sealed field never crosses the boundary.
    expect(JSON.stringify(secrets)).not.toContain("sealed")
    expect((secrets as { metadata?: unknown }[])?.[0]).toMatchObject({ name: "TEST_KEY", keyId: "k1" })
    void env
  })

  it("environments.create/update reject a legacy 'secrets' field and never return one", async () => {
    const workspace = await ok<{ workspaceId: string }>("workspaces", "create", { name: "Acme" })

    const rejected = await router.dispatch({
      domain: "environments",
      action: "create",
      payload: { workspaceId: workspace.workspaceId, name: "Env", secrets: { KEY: "plaintext" } },
    })
    expect(rejected.ok).toBe(false)

    const env = await ok<{ environmentId: string; secrets: Record<string, unknown> }>("environments", "create", {
      workspaceId: workspace.workspaceId,
      name: "Env",
    })
    expect(env.secrets).toEqual({})

    const listed = await ok<{ items: { secrets: Record<string, unknown> }[] }>("environments", "list", {
      workspaceId: workspace.workspaceId,
    })
    expect(listed.items.every((item) => Object.keys(item.secrets).length === 0)).toBe(true)
  })
})
