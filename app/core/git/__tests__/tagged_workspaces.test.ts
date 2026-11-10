import { describe, expect, it, vi } from "vitest"
import type { GitAccountRef } from "@shared/types/GitAccountRef"
import type { GitRepository } from "@shared/types/GitRepository"
import type { GitRepositoryList } from "@shared/types/GitRepositoryList"
import type { Workspace } from "@shared/types/Workspace"
import type { HostCliService } from "../accounts/host_cli_service"
import type { GitSyncService } from "../git_sync_service"
import { listTaggedWorkspaces } from "../tagged_workspaces"

const ACCOUNT: GitAccountRef = { provider: "github", host: "github.com", login: "octo" }

function repository(name: string, overrides: Partial<GitRepository> = {}): GitRepository {
  return {
    owner: "acme",
    name,
    fullName: `acme/${name}`,
    httpsUrl: `https://github.com/acme/${name}.git`,
    sshUrl: `git@github.com:acme/${name}.git`,
    private: true,
    empty: false,
    canPush: true,
    ...overrides,
  }
}

function options(list: GitRepositoryList, connected: readonly string[] = []) {
  const listRepositories = vi.fn(async () => list)
  const workspaceOnRemote = vi.fn((url: string) => (connected.includes(url) ? ({ workspaceId: "ws-known" } as Workspace) : undefined))
  return {
    listRepositories,
    options: {
      hostCli: { listRepositories } as unknown as Pick<HostCliService, "listRepositories">,
      gitSync: { workspaceOnRemote } as Pick<GitSyncService, "workspaceOnRemote">,
    },
  }
}

describe("listTaggedWorkspaces", () => {
  it("lists the account's tagged repositories that hold a workspace not already here, and clones nothing", async () => {
    const fresh = repository("fresh")
    const known = repository("known")
    const empty = repository("empty", { empty: true })
    const { listRepositories, options: listOptions } = options(
      { repositories: [fresh, empty, known], problems: ["acme-org: 403 Forbidden"] },
      [known.httpsUrl],
    )

    const result = await listTaggedWorkspaces(ACCOUNT, listOptions)

    expect(listRepositories).toHaveBeenCalledWith(ACCOUNT, { tagged: true, emptyOnly: false })
    expect(result).toEqual({ repositories: [fresh], problems: ["acme-org: 403 Forbidden"] })
  })

  it("lists nothing when the account has no tagged repositories", async () => {
    const { options: listOptions } = options({ repositories: [], problems: [] })

    await expect(listTaggedWorkspaces(ACCOUNT, listOptions)).resolves.toEqual({ repositories: [], problems: [] })
  })
})
