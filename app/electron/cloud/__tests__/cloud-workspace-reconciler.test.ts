import { describe, it, expect } from "vitest"
import {
  reconcileWorkspaces,
  type ReconcilerBindInput,
  type ReconcilerCatalogEntry,
  type ReconcilerDeps,
  type ReconcilerLocalWorkspace,
} from "../cloud-workspace-reconciler"

interface Recorder {
  ensured: { workspaceId: string; isPersonal: boolean }[]
  created: { id: string; origin: string }[]
  bound: ReconcilerBindInput[]
  initialized: string[]
  reactivateCount: number
}

function makeDeps(
  locals: ReconcilerLocalWorkspace[],
  bound: { workspaceId: string; cloudWorkspaceId: string }[],
  catalog: ReconcilerCatalogEntry[],
): { deps: ReconcilerDeps; rec: Recorder } {
  const rec: Recorder = {
    ensured: [],
    created: [],
    bound: [],
    initialized: [],
    reactivateCount: 0,
  }
  const deps: ReconcilerDeps = {
    listLocalWorkspaces: () => locals,
    listBoundPairs: () => bound,
    catalog: () => catalog,
    ensureSyncWorkspace: async (input) => {
      rec.ensured.push({ workspaceId: input.workspaceId, isPersonal: input.isPersonal })
      // Server provisions under the client-provided id (localId == cloudId).
      return {
        workspaceId: input.workspaceId,
        workspaceName: input.name,
        isPersonal: input.isPersonal,
        canPull: true,
        canPush: true,
      }
    },
    createLocalFromCloud: (input) => {
      rec.created.push({ id: input.id, origin: input.origin })
    },
    bind: (input) => {
      rec.bound.push(input)
    },
    reactivate: () => {
      rec.reactivateCount += 1
    },
    initializeWorkspace: async (workspaceId) => {
      rec.initialized.push(workspaceId)
    },
    log: () => undefined,
  }
  return { deps, rec }
}

const localPersonal: ReconcilerLocalWorkspace = {
  workspaceId: "local-personal",
  name: "Personal",
  slug: "personal",
  isPersonal: true,
}
const cloudPersonal: ReconcilerCatalogEntry = {
  workspaceId: "cloud-personal",
  workspaceName: "Personal",
  isPersonal: true,
  canPull: true,
  canPush: true,
}

describe("reconcileWorkspaces", () => {
  it("pairs local Personal with cloud Personal despite differing ids", async () => {
    const { deps, rec } = makeDeps([localPersonal], [], [cloudPersonal])
    await reconcileWorkspaces(deps)
    expect(rec.ensured).toHaveLength(0)
    expect(rec.bound).toEqual([
      expect.objectContaining({
        workspaceId: "local-personal",
        cloudWorkspaceId: "cloud-personal",
        recordBaseline: true,
      }),
    ])
    expect(rec.initialized).toEqual(["local-personal"])
    expect(rec.reactivateCount).toBe(1)
  })

  it("provisions local-only, non-personal workspaces and pushes a baseline", async () => {
    const local: ReconcilerLocalWorkspace = {
      workspaceId: "local-proj",
      name: "Project",
      slug: "project",
      isPersonal: false,
    }
    const { deps, rec } = makeDeps([local], [], [])
    await reconcileWorkspaces(deps)
    expect(rec.ensured).toEqual([{ workspaceId: "local-proj", isPersonal: false }])
    expect(rec.bound).toEqual([
      expect.objectContaining({
        workspaceId: "local-proj",
        cloudWorkspaceId: "local-proj",
        recordBaseline: true,
      }),
    ])
    expect(rec.created).toHaveLength(0)
    expect(rec.initialized).toEqual(["local-proj"])
  })

  it("downloads cloud-only workspaces keyed by the cloud id, pull-only", async () => {
    const cloudOnly: ReconcilerCatalogEntry = {
      workspaceId: "cloud-team-ws",
      workspaceName: "Team WS",
      teamId: "team-1",
      teamName: "Team One",
      isPersonal: false,
      canPull: true,
      canPush: false,
    }
    const { deps, rec } = makeDeps([], [], [cloudOnly])
    await reconcileWorkspaces(deps)
    expect(rec.created).toEqual([{ id: "cloud-team-ws", origin: "team" }])
    expect(rec.bound).toEqual([
      expect.objectContaining({
        workspaceId: "cloud-team-ws",
        cloudWorkspaceId: "cloud-team-ws",
        teamId: "team-1",
        recordBaseline: false,
      }),
    ])
    expect(rec.ensured).toHaveLength(0)
    expect(rec.initialized).toEqual(["cloud-team-ws"])
  })

  it("skips cloud workspaces the caller cannot pull", async () => {
    const noPull: ReconcilerCatalogEntry = {
      workspaceId: "cloud-nopull",
      workspaceName: "Locked",
      isPersonal: false,
      canPull: false,
      canPush: false,
    }
    const { deps, rec } = makeDeps([], [], [noPull])
    await reconcileWorkspaces(deps)
    expect(rec.created).toHaveLength(0)
    expect(rec.bound).toHaveLength(0)
  })

  it("is idempotent: re-linking an already-synced account does nothing", async () => {
    const { deps, rec } = makeDeps(
      [localPersonal],
      [{ workspaceId: "local-personal", cloudWorkspaceId: "cloud-personal" }],
      [cloudPersonal],
    )
    await reconcileWorkspaces(deps)
    expect(rec.ensured).toHaveLength(0)
    expect(rec.bound).toHaveLength(0)
    expect(rec.created).toHaveLength(0)
    expect(rec.initialized).toHaveLength(0)
    expect(rec.reactivateCount).toBe(0)
  })

  it("handles all four cases together in one pass", async () => {
    const localProj: ReconcilerLocalWorkspace = {
      workspaceId: "local-proj",
      name: "Project",
      slug: "project",
      isPersonal: false,
    }
    const alreadyBoundLocal: ReconcilerLocalWorkspace = {
      workspaceId: "bound-local",
      name: "Bound",
      slug: "bound",
      isPersonal: false,
    }
    const cloudOnly: ReconcilerCatalogEntry = {
      workspaceId: "cloud-only",
      workspaceName: "Cloud Only",
      teamId: "team-9",
      teamName: "Team Nine",
      isPersonal: false,
      canPull: true,
      canPush: true,
    }
    const { deps, rec } = makeDeps(
      [localPersonal, localProj, alreadyBoundLocal],
      [{ workspaceId: "bound-local", cloudWorkspaceId: "bound-local" }],
      [cloudPersonal, cloudOnly],
    )
    await reconcileWorkspaces(deps)
    const boundIds = rec.bound.map((b) => b.workspaceId).sort()
    expect(boundIds).toEqual(["cloud-only", "local-personal", "local-proj"])
    expect(rec.ensured.map((e) => e.workspaceId)).toEqual(["local-proj"])
    expect(rec.created.map((c) => c.id)).toEqual(["cloud-only"])
    expect(rec.initialized.sort()).toEqual(["cloud-only", "local-personal", "local-proj"])
    expect(rec.reactivateCount).toBe(1)
  })
})
