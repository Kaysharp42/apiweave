import { describe, it, expect, beforeEach, afterEach } from "vitest"
import { initDatabase } from "../../db"
import type { InitializedDatabase } from "../../db"
import { WorkspaceRepository } from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver, type ScopeExistence } from "../scope_resolver"
import { WorkspaceService } from "../workspace_service"

let db: InitializedDatabase
let svc: WorkspaceService

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const existence: ScopeExistence = {
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: () => false,
  }
  svc = new WorkspaceService(workspaces, new LocalOnlySyncProvider(), new ScopeResolver(existence))
})

afterEach(() => db.close())

describe("WorkspaceService — personal workspace idempotency guard", () => {
  it("returns the existing personal workspace instead of creating a dupe", async () => {
    const first = await svc.create({ name: "Personal", slug: "personal", isPersonal: true })
    const second = await svc.create({ name: "Personal", slug: "personal", isPersonal: true })

    expect(second.workspaceId).toBe(first.workspaceId)
    expect(second.slug).toBe("personal")
    const all = await svc.list()
    expect(all.filter((ws) => ws.isPersonal)).toHaveLength(1)
  })

  it("still creates a non-personal workspace when isPersonal is false", async () => {
    const personal = await svc.create({ name: "Personal", slug: "personal", isPersonal: true })
    const team = await svc.create({ name: "Team", slug: "team", isPersonal: false })

    expect(team.workspaceId).not.toBe(personal.workspaceId)
    const all = await svc.list()
    expect(all).toHaveLength(2)
  })

  it("treats omitted isPersonal as personal (default) and dedupes", async () => {
    const first = await svc.create({ name: "Personal" })
    const second = await svc.create({ name: "Personal" })

    expect(second.workspaceId).toBe(first.workspaceId)
  })
})