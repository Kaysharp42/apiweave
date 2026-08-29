import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import { EnvironmentRepository, SecretRepository, WorkspaceRepository } from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { SecretService } from "../secret_service"

/**
 * A secret belongs to exactly one scope, and a scope to exactly one workspace.
 * These cover the two operations that deliberately cross that border — duplicate
 * and move — including the one thing that makes them possible at all: the sealed
 * bytes still open in the destination, because the seed is machine-wide.
 */

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let environments: EnvironmentRepository
let store: SecretRepository
let service: SecretService
const permissions = new LocalOwnerProvider()
const sync = new LocalOnlySyncProvider()
const MASTER_KEK = new Uint8Array(32).fill(7)

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  environments = new EnvironmentRepository(db.kvStore)
  store = new SecretRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  service = new SecretService(
    store,
    sync,
    permissions,
    new ScopeResolver(existence),
    environments,
    MASTER_KEK,
  )
})

afterEach(() => db.close())

const seedWorkspace = (slug: string): string => workspaces.create({ name: slug, slug }).workspaceId

/** Seal `value` against the scope's public key exactly as the renderer does. */
async function put(workspaceId: string, scopeId: string, name: string, value: string) {
  const { keyId, publicKey } = await service.publicKey(workspaceId, "workspace", scopeId)
  const { seal } = await import("../../secrets/sealed_box")
  return service.set(workspaceId, {
    name,
    scopeType: "workspace",
    scopeId,
    keyId,
    sealed: await seal(value, new Uint8Array(Buffer.from(publicKey, "base64"))),
  })
}

describe("SecretService.duplicate", () => {
  it("copies a value into another workspace, where it still opens", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    await put(wsA, wsA, "API_KEY", "s3cret")

    const copy = await service.duplicate(wsA, "workspace", wsA, "API_KEY", {
      workspaceId: wsB,
      scopeType: "workspace",
      scopeId: wsB,
    })

    expect(copy.scopeId).toBe(wsB)
    // The keyId is re-stamped, or metadata would keep naming the scope it left.
    expect(copy.keyId).toBe(`sealed-box:workspace:${wsB}`)
    // The point of the whole feature: the carried-over bytes still open. They
    // would not if the seed were per-scope rather than machine-wide.
    const resolved = await service.resolvePlaintext("API_KEY", { workspaceId: wsB })
    expect(resolved.plaintext).toBe("s3cret")
    // ...and the source is untouched.
    expect(store.listByScope("workspace", wsA)).toHaveLength(1)
  })

  it("renames on the way over, leaving the original name free", async () => {
    const ws = seedWorkspace("a")
    await put(ws, ws, "API_KEY", "s3cret")

    const copy = await service.duplicate(ws, "workspace", ws, "API_KEY", {
      workspaceId: ws,
      scopeType: "workspace",
      scopeId: ws,
      name: "API_KEY_STAGING",
    })

    expect(copy.name).toBe("API_KEY_STAGING")
    expect(store.listByScope("workspace", ws).map((s) => s.name)).toEqual([
      "API_KEY",
      "API_KEY_STAGING",
    ])
  })

  it("refuses to overwrite a name already taken in the destination", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    await put(wsA, wsA, "API_KEY", "from-a")
    await put(wsB, wsB, "API_KEY", "from-b")

    await expect(
      service.duplicate(wsA, "workspace", wsA, "API_KEY", {
        workspaceId: wsB,
        scopeType: "workspace",
        scopeId: wsB,
      }),
    ).rejects.toMatchObject({ code: "validation" })

    // Nothing can read a secret back, so a silent overwrite here would destroy
    // a value with no way to notice or undo it.
    const survived = await service.resolvePlaintext("API_KEY", { workspaceId: wsB })
    expect(survived.plaintext).toBe("from-b")
  })

  it("refuses a copy onto itself", async () => {
    const ws = seedWorkspace("a")
    await put(ws, ws, "API_KEY", "s3cret")

    await expect(
      service.duplicate(ws, "workspace", ws, "API_KEY", {
        workspaceId: ws,
        scopeType: "workspace",
        scopeId: ws,
      }),
    ).rejects.toMatchObject({ code: "validation" })
  })

  it("hides a secret in another workspace as not_found", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    await put(wsB, wsB, "API_KEY", "from-b")

    // wsA naming wsB's scope: the scope check rejects it before any read.
    await expect(
      service.duplicate(wsA, "workspace", wsB, "API_KEY", {
        workspaceId: wsA,
        scopeType: "workspace",
        scopeId: wsA,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
  })

  it("refuses a destination scope that does not belong to the destination workspace", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const foreign = environments.create({ workspaceId: wsB, name: "Foreign" })
    await put(wsA, wsA, "API_KEY", "s3cret")

    await expect(
      service.duplicate(wsA, "workspace", wsA, "API_KEY", {
        workspaceId: wsA,
        scopeType: "environment",
        scopeId: foreign.environmentId,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
  })
})

describe("SecretService.moveToScope", () => {
  it("re-homes the value and stops resolving in the workspace it left", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    await put(wsA, wsA, "API_KEY", "s3cret")

    const moved = await service.moveToScope(wsA, "workspace", wsA, "API_KEY", {
      workspaceId: wsB,
      scopeType: "workspace",
      scopeId: wsB,
    })

    expect(moved.scopeId).toBe(wsB)
    expect(store.listByScope("workspace", wsA)).toEqual([])
    const there = await service.resolvePlaintext("API_KEY", { workspaceId: wsB })
    expect(there.plaintext).toBe("s3cret")
    const gone = await service.resolvePlaintext("API_KEY", { workspaceId: wsA })
    expect(gone.plaintext).toBeNull()
  })

  it("moves into an environment scope, where it overrides the workspace one", async () => {
    const ws = seedWorkspace("a")
    const env = environments.create({ workspaceId: ws, name: "Staging" })
    await put(ws, ws, "API_KEY", "workspace-wide")

    await service.moveToScope(ws, "workspace", ws, "API_KEY", {
      workspaceId: ws,
      scopeType: "environment",
      scopeId: env.environmentId,
    })

    const resolved = await service.resolvePlaintext("API_KEY", {
      environmentId: env.environmentId,
      workspaceId: ws,
    })
    expect(resolved).toEqual({ plaintext: "workspace-wide", scopeType: "environment" })
  })

  it("keeps the source when the destination name is taken", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    await put(wsA, wsA, "API_KEY", "from-a")
    await put(wsB, wsB, "API_KEY", "from-b")

    await expect(
      service.moveToScope(wsA, "workspace", wsA, "API_KEY", {
        workspaceId: wsB,
        scopeType: "workspace",
        scopeId: wsB,
      }),
    ).rejects.toMatchObject({ code: "validation" })

    // Copy-then-remove: a refused copy must not have removed the source first.
    const stillThere = await service.resolvePlaintext("API_KEY", { workspaceId: wsA })
    expect(stillThere.plaintext).toBe("from-a")
  })

  it("hides a secret in another workspace as not_found", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    await put(wsB, wsB, "API_KEY", "from-b")

    await expect(
      service.moveToScope(wsA, "workspace", wsB, "API_KEY", {
        workspaceId: wsA,
        scopeType: "workspace",
        scopeId: wsA,
      }),
    ).rejects.toMatchObject({ code: "not_found" })
    expect(store.listByScope("workspace", wsB)).toHaveLength(1)
  })
})
