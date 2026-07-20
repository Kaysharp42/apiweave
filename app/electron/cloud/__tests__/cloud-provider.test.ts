import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
  activateCloudSync,
  deactivateCloudSync,
  handleWorkspaceOpened,
  handleEditCommitted,
  type WorkspaceRef,
} from "../cloud-provider"
import { getState, resetState } from "../cloud-state"
import { resetSyncProvider, getSyncProvider } from "../../../core/services-locator"

// ─── Mock CloudSyncProvider ──────────────────────────────────────────────────
// The real CloudSyncProvider needs a KVStore to work. For testing cloud-provider
// (which wires up the provider and handles IPC events), we mock the provider
// to track pull/push calls without needing a real store.

const mockPull = vi.fn().mockResolvedValue(undefined)
const mockPush = vi.fn().mockResolvedValue(undefined)

vi.mock("../cloud-transport", async () => {
  const actual = await vi.importActual("../cloud-transport")
  return {
    ...actual,
    createCloudClient: vi.fn(() => ({})),
    CloudSyncProvider: class FakeCloudSyncProvider {
      private onState: (s: string) => void
      constructor(_client: unknown, callback: unknown) {
        this.onState = callback as (s: string) => void
      }
      async pull() {
        this.onState("syncing")
        try {
          await mockPull()
          this.onState("idle")
        } catch (e) {
          this.onState("error")
          throw e
        }
      }
      async push() {
        this.onState("syncing")
        try {
          await mockPush()
          this.onState("idle")
        } catch (e) {
          this.onState("error")
          throw e
        }
      }
    },
  }
})

// ─── Workspaces ──────────────────────────────────────────────────────────────

const cloudWorkspace: WorkspaceRef = {
  id: "ws-cloud-1",
  origin: "cloud",
  syncMode: "bi-directional",
}

const teamWorkspace: WorkspaceRef = {
  id: "ws-team-1",
  origin: "team",
  syncMode: "push",
}

const localOnlyWorkspace: WorkspaceRef = {
  id: "ws-local-1",
  origin: "local",
  syncMode: "none",
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("cloud-provider", () => {
  beforeEach(() => {
    resetState()
    resetSyncProvider()
    mockPull.mockClear()
    mockPush.mockClear()
    vi.useFakeTimers()
  })

  afterEach(() => {
    deactivateCloudSync()
    vi.useRealTimers()
  })

  describe("activation", () => {
    it("calls setSyncProvider on activateCloudSync", () => {
      activateCloudSync({ tokenStore: {} as never })
      expect(getSyncProvider()).toBeDefined()
    })

    it("sets initial state to idle", () => {
      activateCloudSync({ tokenStore: {} as never })
      expect(getState()).toBe("idle")
    })
  })

  describe("workspace:opened — happy path", () => {
    it("triggers pull for cloud workspace", async () => {
      activateCloudSync({ tokenStore: {} as never })
      await handleWorkspaceOpened(cloudWorkspace)
      expect(mockPull).toHaveBeenCalledTimes(1)
    })

    it("triggers pull for team workspace", async () => {
      activateCloudSync({ tokenStore: {} as never })
      await handleWorkspaceOpened(teamWorkspace)
      expect(mockPull).toHaveBeenCalledTimes(1)
    })

    it("emits syncing then idle on successful pull", async () => {
      activateCloudSync({ tokenStore: {} as never })
      const states: string[] = []
      const { subscribe } = await import("../cloud-state")
      const unsub = subscribe((s) => states.push(s))

      const pullPromise = handleWorkspaceOpened(cloudWorkspace)
      await pullPromise
      expect(getState()).toBe("idle")
      expect(states).toEqual(["syncing", "idle"])
      unsub()
    })
  })

  describe("workspace:edit-committed — happy path", () => {
    it("triggers debounced push for cloud workspace", async () => {
      activateCloudSync({ tokenStore: {} as never })
      handleEditCommitted(cloudWorkspace)
      expect(mockPush).not.toHaveBeenCalled()
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
      expect(mockPush).toHaveBeenCalledTimes(1)
    })

    it("resets debounce on rapid edits", async () => {
      activateCloudSync({ tokenStore: {} as never })
      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(1000)
      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(1000)
      expect(mockPush).not.toHaveBeenCalled()
      vi.advanceTimersByTime(1000)
      await Promise.resolve()
      expect(mockPush).toHaveBeenCalledTimes(1)
    })

    it("emits syncing then idle on successful push", async () => {
      activateCloudSync({ tokenStore: {} as never })
      const states: string[] = []
      const { subscribe } = await import("../cloud-state")
      const unsub = subscribe((s) => states.push(s))

      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
      expect(getState()).toBe("idle")
      expect(states).toContain("syncing")
      expect(states).toContain("idle")
      unsub()
    })
  })

  describe("exclusions — local-only workspaces", () => {
    it("skips pull for local-only workspace", async () => {
      activateCloudSync({ tokenStore: {} as never })
      await handleWorkspaceOpened(localOnlyWorkspace)
      expect(mockPull).not.toHaveBeenCalled()
    })

    it("skips push for local-only workspace", async () => {
      activateCloudSync({ tokenStore: {} as never })
      handleEditCommitted(localOnlyWorkspace)
      vi.advanceTimersByTime(2000)
      expect(mockPush).not.toHaveBeenCalled()
    })
  })

  describe("negative — error handling", () => {
    it("emits error state on pull failure", async () => {
      mockPull.mockRejectedValueOnce(new Error("network down"))
      activateCloudSync({ tokenStore: {} as never })
      await handleWorkspaceOpened(cloudWorkspace)
      expect(getState()).toBe("error")
    })

    it("emits error state on push failure", async () => {
      mockPush.mockRejectedValueOnce(new Error("token revoked"))
      activateCloudSync({ tokenStore: {} as never })
      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
      expect(getState()).toBe("error")
    })

    it("does not push if provider not activated", async () => {
      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(2000)
      expect(getState()).toBe("idle")
    })
  })

  describe("deactivation", () => {
    it("clears pending push timer on deactivate", async () => {
      activateCloudSync({ tokenStore: {} as never })
      handleEditCommitted(cloudWorkspace)
      deactivateCloudSync()
      vi.advanceTimersByTime(2000)
      expect(mockPush).not.toHaveBeenCalled()
    })

    it("resets state to idle on deactivate", () => {
      activateCloudSync({ tokenStore: {} as never })
      deactivateCloudSync()
      expect(getState()).toBe("idle")
    })
  })
})
