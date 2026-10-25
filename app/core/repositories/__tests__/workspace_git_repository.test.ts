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

describe("a merge waiting for the user", () => {
  const PICK = { recordId: "wf", path: "name", side: "ours" as const }

  it("holds a two-way merge with no base commit, and reads its picks back", () => {
    workspaceGit.startMerge(workspaceId, null, "ours".repeat(10), "theirs".repeat(10), [PICK])

    expect(workspaceGit.getMerge(workspaceId)).toEqual({
      workspaceId,
      baseCommit: null,
      ourCommit: "ours".repeat(10),
      theirCommit: "theirs".repeat(10),
      picks: [PICK],
    })
  })

  it("replaces the picks only for the merge's own base, two-way's null included", () => {
    workspaceGit.startMerge(workspaceId, "base", "ours", "theirs", [])

    expect(workspaceGit.setMergePicks(workspaceId, "base", [PICK])).toBe(true)
    expect(workspaceGit.getMerge(workspaceId)?.picks).toEqual([PICK])
    expect(workspaceGit.setMergePicks(workspaceId, "another", [])).toBe(false)

    workspaceGit.startMerge(workspaceId, null, "ours", "theirs", [])
    expect(workspaceGit.setMergePicks(workspaceId, null, [PICK])).toBe(true)
    expect(workspaceGit.getMerge(workspaceId)).toMatchObject({ baseCommit: null, picks: [PICK] })
  })

  it("goes with the remote the merge waited on", () => {
    workspaceGit.setRemote(workspaceId, "https://github.com/acme/tests.git", "main", null)
    workspaceGit.startMerge(workspaceId, null, "ours", "theirs", [PICK])

    workspaceGit.clearRemote(workspaceId)

    expect(workspaceGit.getMerge(workspaceId)).toBeUndefined()
  })
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
