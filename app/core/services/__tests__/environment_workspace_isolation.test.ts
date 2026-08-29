import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import {
  EnvironmentRepository,
  SecretRepository,
  WorkflowRepository,
  WorkspaceRepository,
} from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { EnvironmentService } from "../environment_service"

/**
 * An environment belongs to exactly one workspace. These cover the two
 * operations that deliberately cross that border — duplicate and move — and the
 * references each has to clear on the way out. The isolation itself (list, get,
 * base-environment) is covered in `services.test.ts`.
 */

let db: InitializedDatabase
let workspaces: WorkspaceRepository
let workflows: WorkflowRepository
let environments: EnvironmentRepository
let secrets: SecretRepository
let service: EnvironmentService
const permissions = new LocalOwnerProvider()
const sync = new LocalOnlySyncProvider()

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaces = new WorkspaceRepository(db.kvStore)
  workflows = new WorkflowRepository(db.kvStore)
  environments = new EnvironmentRepository(db.kvStore)
  secrets = new SecretRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  }
  service = new EnvironmentService(
    environments,
    sync,
    permissions,
    new ScopeResolver(existence),
    workflows,
    secrets,
  )
})

afterEach(() => db.close())

const seedWorkspace = (slug: string): string => workspaces.create({ name: slug, slug }).workspaceId

describe("EnvironmentService.duplicate", () => {
  it("copies variables into the same workspace under a new id", async () => {
    const ws = seedWorkspace("a")
    const source = await service.create(ws, {
      name: "Staging",
      description: "the staging rig",
      variables: { host: "stage.example.com" },
    })

    const copy = await service.duplicate(ws, source.environmentId)

    expect(copy.environmentId).not.toBe(source.environmentId)
    expect(copy.workspaceId).toBe(ws)
    expect(copy.name).toBe("Staging (copy)")
    expect(copy.description).toBe("the staging rig")
    expect(copy.variables).toEqual({ host: "stage.example.com" })
    // The original is untouched.
    expect(environments.getById(source.environmentId)?.name).toBe("Staging")
  })

  it("never hands the copy the default flag, and honours an explicit name", async () => {
    const ws = seedWorkspace("a")
    const source = await service.create(ws, { name: "Staging", isDefault: true })

    const copy = await service.duplicate(ws, source.environmentId, undefined, "Staging EU")

    expect(copy.name).toBe("Staging EU")
    expect(copy.isDefault).toBe(false)
    expect(environments.getById(source.environmentId)?.isDefault).toBe(true)
  })

  it("keeps the base link within a workspace but drops it across one", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const base = await service.create(wsA, { name: "base", variables: { region: "eu" } })
    const leaf = await service.create(wsA, {
      name: "leaf",
      baseEnvironmentId: base.environmentId,
    })

    const sameWorkspace = await service.duplicate(wsA, leaf.environmentId)
    expect(sameWorkspace.baseEnvironmentId).toBe(base.environmentId)

    // A base must live in the same workspace, so it cannot cross with the copy —
    // keeping the link would make the copy unsaveable on its next edit.
    const crossWorkspace = await service.duplicate(wsA, leaf.environmentId, wsB)
    expect(crossWorkspace.workspaceId).toBe(wsB)
    expect(crossWorkspace.baseEnvironmentId).toBeNull()
  })

  it("does not copy secrets", async () => {
    const ws = seedWorkspace("a")
    const source = await service.create(ws, { name: "Staging" })
    secrets.put({
      workspaceId: ws,
      scopeType: "environment",
      scopeId: source.environmentId,
      name: "API_KEY",
      keyId: "k1",
      sealed: new Uint8Array([1, 2, 3]),
    })

    const copy = await service.duplicate(ws, source.environmentId)

    expect(secrets.listByScope("environment", copy.environmentId)).toEqual([])
    expect(secrets.listByScope("environment", source.environmentId)).toHaveLength(1)
  })

  it("hides an environment from another workspace as not_found", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const foreign = environments.create({ workspaceId: wsB, name: "Foreign" })

    await expect(service.duplicate(wsA, foreign.environmentId)).rejects.toMatchObject({
      code: "not_found",
    })
  })
})

describe("EnvironmentService.moveToWorkspace", () => {
  it("re-homes the environment and takes it out of the source's list", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const env = await service.create(wsA, { name: "Staging", variables: { host: "x" } })

    const moved = await service.moveToWorkspace(wsA, env.environmentId, wsB)

    expect(moved.workspaceId).toBe(wsB)
    expect(moved.scopeId).toBe(wsB)
    expect(moved.variables).toEqual({ host: "x" })
    expect(environments.listByWorkspace(wsA).items).toEqual([])
    expect(environments.listByWorkspace(wsB).items.map((e) => e.environmentId)).toEqual([
      env.environmentId,
    ])
  })

  it("rejects a move into the workspace it is already in", async () => {
    const ws = seedWorkspace("a")
    const env = await service.create(ws, { name: "Staging" })

    await expect(service.moveToWorkspace(ws, env.environmentId, ws)).rejects.toMatchObject({
      code: "validation",
    })
  })

  it("clears the selection on workflows left behind", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const env = await service.create(wsA, { name: "Staging" })
    const user = workflows.create({
      workspaceId: wsA,
      name: "uses it",
      selectedEnvironmentId: env.environmentId,
    })
    const bystander = workflows.create({ workspaceId: wsA, name: "does not" })

    await service.moveToWorkspace(wsA, env.environmentId, wsB)

    // Left dangling, this workflow would fail at run time with a resolution
    // error naming an environment that is no longer in its workspace.
    expect(workflows.getById(user.workflowId)?.selectedEnvironmentId).toBeNull()
    expect(workflows.getById(bystander.workflowId)?.selectedEnvironmentId).toBeNull()
  })

  it("clears base links pointing at it, and its own", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const base = await service.create(wsA, { name: "base" })
    const moving = await service.create(wsA, {
      name: "moving",
      baseEnvironmentId: base.environmentId,
    })
    const child = await service.create(wsA, {
      name: "child",
      baseEnvironmentId: moving.environmentId,
    })

    const moved = await service.moveToWorkspace(wsA, moving.environmentId, wsB)

    expect(moved.baseEnvironmentId).toBeNull()
    expect(environments.getById(child.environmentId)?.baseEnvironmentId).toBeNull()
    expect(environments.getById(base.environmentId)?.baseEnvironmentId).toBeNull()
  })

  it("gives up the default flag rather than carrying it into the destination", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const env = await service.create(wsA, { name: "Staging", isDefault: true })

    const moved = await service.moveToWorkspace(wsA, env.environmentId, wsB)

    expect(moved.isDefault).toBe(false)
  })

  it("takes environment-scoped secrets along, re-homed onto the destination", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const env = await service.create(wsA, { name: "Staging" })
    secrets.put({
      workspaceId: wsA,
      scopeType: "environment",
      scopeId: env.environmentId,
      name: "API_KEY",
      keyId: "k1",
      sealed: new Uint8Array([1, 2, 3]),
    })

    await service.moveToWorkspace(wsA, env.environmentId, wsB)

    // Still readable by scope...
    expect(secrets.listByScope("environment", env.environmentId)).toHaveLength(1)
    expect(secrets.getCiphertext("environment", env.environmentId, "API_KEY")).toEqual(
      new Uint8Array([1, 2, 3]),
    )
    // ...and, crucially, owned by the destination. `workspace_id` is the FK that
    // ON DELETE CASCADE follows: left behind, the secret dies with wsA.
    const row = db.kvStore.get<{ workspace_id: string }>(
      "SELECT workspace_id FROM secrets_metadata WHERE scopeId = ?",
      [env.environmentId],
    )
    expect(row?.workspace_id).toBe(wsB)

    // Control: a secret still owned by wsA IS destroyed by the same delete, so
    // the survival above is the re-home doing its job and not a dead FK.
    secrets.put({
      workspaceId: wsA,
      scopeType: "workspace",
      scopeId: wsA,
      name: "LEFT_BEHIND",
      keyId: "k2",
      sealed: new Uint8Array([9]),
    })
    workspaces.delete(wsA)
    expect(secrets.listByScope("workspace", wsA)).toEqual([])
    expect(secrets.listByScope("environment", env.environmentId)).toHaveLength(1)
  })

  it("hides an environment from another workspace as not_found", async () => {
    const wsA = seedWorkspace("a")
    const wsB = seedWorkspace("b")
    const foreign = environments.create({ workspaceId: wsB, name: "Foreign" })

    await expect(
      service.moveToWorkspace(wsA, foreign.environmentId, wsA),
    ).rejects.toMatchObject({ code: "not_found" })
  })
})

describe("EnvironmentService.delete — reference detachment", () => {
  it("clears the workflows and base links that pointed at the deleted environment", async () => {
    const ws = seedWorkspace("a")
    const env = await service.create(ws, { name: "Staging" })
    const child = await service.create(ws, {
      name: "child",
      baseEnvironmentId: env.environmentId,
    })
    const user = workflows.create({
      workspaceId: ws,
      name: "uses it",
      selectedEnvironmentId: env.environmentId,
    })

    await service.delete(ws, env.environmentId)

    expect(environments.getById(env.environmentId)).toBeUndefined()
    expect(workflows.getById(user.workflowId)?.selectedEnvironmentId).toBeNull()
    expect(environments.getById(child.environmentId)?.baseEnvironmentId).toBeNull()
  })
})
