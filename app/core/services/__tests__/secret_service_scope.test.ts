import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import { EnvironmentRepository, WorkspaceRepository } from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { SecretService } from "../secret_service"
import { NotFoundError } from "../../ipc/errors"
import type { SecretMetadata, SecretScopeType } from "../../secrets/scoped_secret_resolver"
import type { SecretWriteStore, SecretUpsert } from "../../secrets/SecretStore"

/** In-memory write-only secret store — mirrors the fake used by the handler tests. */
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
  getCiphertext(): null {
    return null
  }
}

describe("SecretService — scope IDs are bound to the authorized workspace (cross-tenant guard)", () => {
  let db: InitializedDatabase
  let secretService: SecretService
  let workspaceA: string
  let workspaceB: string
  let environmentInB: string

  beforeEach(() => {
    db = initDatabase({ databasePath: ":memory:" })
    const workspaces = new WorkspaceRepository(db.kvStore)
    const environments = new EnvironmentRepository(db.kvStore)
    const existence: ScopeExistence = {
      workspaceExists: (id) => workspaces.getById(id) !== undefined,
      environmentExists: (id) => environments.getById(id) !== undefined,
    }
    const scopeResolver = new ScopeResolver(existence)
    const permissions = new LocalOwnerProvider()
    const sync = new LocalOnlySyncProvider()

    workspaceA = workspaces.create({ name: "Workspace A", slug: "workspace-a" }).workspaceId
    workspaceB = workspaces.create({ name: "Workspace B", slug: "workspace-b" }).workspaceId
    environmentInB = environments.create({ workspaceId: workspaceB, name: "Prod" }).environmentId

    secretService = new SecretService(new FakeSecretStore(), sync, permissions, scopeResolver, environments, new Uint8Array(32))
  })

  afterEach(() => db.close())

  it("rejects set() when scopeId names a foreign workspace", async () => {
    await expect(
      secretService.set(workspaceA, {
        name: "API_KEY",
        scopeType: "workspace",
        scopeId: workspaceB,
        keyId: "k1",
        sealed: new Uint8Array(),
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it("rejects set() when scopeId names an environment owned by a foreign workspace", async () => {
    await expect(
      secretService.set(workspaceA, {
        name: "API_KEY",
        scopeType: "environment",
        scopeId: environmentInB,
        keyId: "k1",
        sealed: new Uint8Array(),
      }),
    ).rejects.toThrow(NotFoundError)
  })

  it("rejects list()/delete() for a foreign scopeId", async () => {
    await expect(secretService.list(workspaceA, "workspace", workspaceB)).rejects.toThrow(NotFoundError)
    await expect(secretService.delete(workspaceA, "environment", environmentInB, "API_KEY")).rejects.toThrow(NotFoundError)
  })

  it("rejects resolve() when the chain names a foreign workspace or environment", async () => {
    await expect(secretService.resolve(workspaceA, { workspaceId: workspaceB }, "API_KEY")).rejects.toThrow(NotFoundError)
    await expect(secretService.resolve(workspaceA, { environmentId: environmentInB }, "API_KEY")).rejects.toThrow(NotFoundError)
  })

  it("allows operations scoped to the caller's own authorized workspace/environment", async () => {
    const ownEnv = new EnvironmentRepository(db.kvStore).create({ workspaceId: workspaceA, name: "Dev" }).environmentId
    await expect(
      secretService.set(workspaceA, { name: "API_KEY", scopeType: "workspace", scopeId: workspaceA, keyId: "k1", sealed: new Uint8Array() }),
    ).resolves.toMatchObject({ scopeId: workspaceA })
    await expect(secretService.resolve(workspaceA, { workspaceId: workspaceA, environmentId: ownEnv }, "API_KEY")).resolves.not.toBeNull()
  })
})
