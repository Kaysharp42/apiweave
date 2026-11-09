import { describe, expect, it, vi } from "vitest"
import type { GitAccountRef } from "@shared/types/GitAccountRef"
import type { GitRepository } from "@shared/types/GitRepository"
import type { GitRepositoryList } from "@shared/types/GitRepositoryList"
import type { OpenWorkspaceFromGitResult } from "@shared/types/OpenWorkspaceFromGitResult"
import type { HostCliService } from "../accounts/host_cli_service"
import { GitSyncDisposedError, type GitSyncService } from "../git_sync_service"
import { importTaggedWorkspaces, type ImportedTaggedWorkspace } from "../tagged_workspace_import"

const ACCOUNT: GitAccountRef = { provider: "github", host: "github.com", login: "octo" }

function repository(overrides: Partial<GitRepository> = {}): GitRepository {
  return {
    owner: "acme",
    name: "tests",
    fullName: "acme/tests",
    httpsUrl: "https://github.com/acme/tests.git",
    sshUrl: "git@github.com:acme/tests.git",
    private: true,
    empty: false,
    canPush: true,
    ...overrides,
  }
}

function importer(list: GitRepositoryList, open: (url: string) => Promise<OpenWorkspaceFromGitResult>) {
  const listRepositories = vi.fn(async () => list)
  const openFromGit = vi.fn(open)
  return {
    listRepositories,
    openFromGit,
    options: {
      hostCli: { listRepositories } as unknown as Pick<HostCliService, "listRepositories">,
      gitSync: { openFromGit } as unknown as Pick<GitSyncService, "openFromGit">,
    },
  }
}

describe("importTaggedWorkspaces", () => {
  it("asks for the account's tagged repositories and opens every non-empty one as that account", async () => {
    const fresh = repository({ name: "fresh", fullName: "acme/fresh", httpsUrl: "https://github.com/acme/fresh.git" })
    const duplicate = repository({ name: "known", fullName: "acme/known", httpsUrl: "https://github.com/acme/known.git" })
    const empty = repository({ name: "empty", fullName: "acme/empty", empty: true })
    const opened: ImportedTaggedWorkspace[] = []
    const { listRepositories, openFromGit, options } = importer(
      { repositories: [fresh, empty, duplicate], problems: [] },
      async (url) =>
        url === duplicate.httpsUrl
          ? { kind: "duplicate", workspaceId: "ws-known", slug: "known", name: "Known" }
          : { kind: "opened", workspaceId: "ws-fresh", slug: "fresh", name: "Fresh", warnings: [] },
    )

    const result = await importTaggedWorkspaces(ACCOUNT, { ...options, onOpened: (workspace) => opened.push(workspace) })

    expect(listRepositories).toHaveBeenCalledWith(ACCOUNT, { tagged: true, emptyOnly: false })
    expect(openFromGit.mock.calls).toEqual([
      [fresh.httpsUrl, ACCOUNT],
      [duplicate.httpsUrl, ACCOUNT],
    ])
    expect(result).toEqual({
      opened: [{ repository: "acme/fresh", workspaceId: "ws-fresh", slug: "fresh", name: "Fresh" }],
      skipped: 2,
      problems: [],
    })
    expect(opened).toEqual(result.opened)
  })

  it("keeps going when a repository cannot be opened, and reports it with the host's list problems", async () => {
    const broken = repository({ name: "broken", fullName: "acme/broken", httpsUrl: "https://github.com/acme/broken.git" })
    const fresh = repository({ name: "fresh", fullName: "acme/fresh", httpsUrl: "https://github.com/acme/fresh.git" })
    const { openFromGit, options } = importer({ repositories: [broken, fresh], problems: ["acme-org: 403 Forbidden"] }, async (url) => {
      if (url === broken.httpsUrl) throw new Error("This is not an APIWeave workspace repository.")
      return { kind: "opened", workspaceId: "ws-fresh", slug: "fresh", name: "Fresh", warnings: [] }
    })

    const result = await importTaggedWorkspaces(ACCOUNT, options)

    expect(openFromGit).toHaveBeenCalledTimes(2)
    expect(result.opened.map((workspace) => workspace.repository)).toEqual(["acme/fresh"])
    expect(result.problems).toEqual([
      "acme-org: 403 Forbidden",
      "acme/broken: This is not an APIWeave workspace repository.",
    ])
  })

  it("stops at the first open refused because the app is quitting", async () => {
    const first = repository({ name: "first", fullName: "acme/first", httpsUrl: "https://github.com/acme/first.git" })
    const second = repository({ name: "second", fullName: "acme/second", httpsUrl: "https://github.com/acme/second.git" })
    const { openFromGit, options } = importer({ repositories: [first, second], problems: [] }, async () => {
      throw new GitSyncDisposedError()
    })

    await expect(importTaggedWorkspaces(ACCOUNT, options)).resolves.toEqual({ opened: [], skipped: 0, problems: [] })
    expect(openFromGit).toHaveBeenCalledTimes(1)
  })

  it("opens nothing when the account has no tagged repositories", async () => {
    const { openFromGit, options } = importer({ repositories: [], problems: [] }, async () => {
      throw new Error("nothing should be opened")
    })

    await expect(importTaggedWorkspaces(ACCOUNT, options)).resolves.toEqual({ opened: [], skipped: 0, problems: [] })
    expect(openFromGit).not.toHaveBeenCalled()
  })
})
