import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { GitAccountRef } from "@shared/types/GitAccountRef"
import { initDatabase, type InitializedDatabase } from "../../db"
import { WorkspaceGitRepository } from "../WorkspaceGitRepository"
import { WorkspaceRepository } from "../WorkspaceRepository"

const ACCOUNT: GitAccountRef = { provider: "github", host: "github.com", login: "octo" }

let db: InitializedDatabase
let workspaceGit: WorkspaceGitRepository
let workspaceId: string

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
  workspaceId = new WorkspaceRepository(db.kvStore).create({ name: "Acme", slug: "acme" }).workspaceId
  workspaceGit = new WorkspaceGitRepository(db.kvStore)
  workspaceGit.insert(workspaceId, "auto")
})

afterEach(() => {
  db.close()
})

describe("a workspace's git account", () => {
  it("is none until a remote is bound with one", () => {
    expect(workspaceGit.get(workspaceId)?.account).toBeNull()

    workspaceGit.setRemote(workspaceId, "https://github.com/acme/tests.git", "main", ACCOUNT)

    expect(workspaceGit.get(workspaceId)?.account).toEqual(ACCOUNT)
  })

  it("changes without touching where the two last agreed, and drops a refusal that was the old account's", () => {
    workspaceGit.setRemote(workspaceId, "https://github.com/acme/tests.git", "main", null)
    workspaceGit.recordSynced(workspaceId, "a".repeat(40), "2026-10-22T10:00:00.000Z")
    workspaceGit.setReadOnly(workspaceId, true)

    expect(workspaceGit.setAccount(workspaceId, ACCOUNT)).toBe(true)

    expect(workspaceGit.get(workspaceId)).toMatchObject({ account: ACCOUNT, readOnly: false, lastSyncedCommit: "a".repeat(40) })
  })

  it("goes with the remote", () => {
    workspaceGit.setRemote(workspaceId, "https://github.com/acme/tests.git", "main", ACCOUNT)

    workspaceGit.clearRemote(workspaceId)

    expect(workspaceGit.get(workspaceId)).toMatchObject({ remoteUrl: null, account: null })
  })

  it.each([
    { what: "a provider it has no tool for", values: ["bitbucket", "bitbucket.org", "octo"] },
    { what: "only some of the columns", values: ["github", null, "octo"] },
  ])("refuses a row holding $what rather than guessing an account", ({ values }) => {
    db.kvStore.set("UPDATE workspace_git SET account_provider = ?, account_host = ?, account_login = ? WHERE workspace_id = ?", [...values, workspaceId])

    expect(() => workspaceGit.get(workspaceId)).toThrow(/incomplete or unknown account/)
  })
})
