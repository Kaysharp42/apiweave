import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { CloudClient, DeviceTokenStore } from "../cloud-transport"
import {
  activateCloudSync,
  deactivateCloudSync,
  handleWorkspaceOpened,
  handleEditCommitted,
  type WorkspaceRef,
} from "../cloud-provider"
import { getState, resetState } from "../cloud-state"
import { resetSyncProvider, getSyncProvider } from "../../../core/services-locator"

// ─── Fakes ───────────────────────────────────────────────────────────────────

function createFakeClient(): CloudClient & { pullCount: number; pushCount: number } {
  const client: CloudClient & { pullCount: number; pushCount: number } = {
    pullCount: 0,
    pushCount: 0,
    async pull() {
      client.pullCount++
    },
    async push() {
      client.pushCount++
    },
  }
  return client
}

function createFailingClient(error: Error): CloudClient {
  return {
    async pull() {
      throw error
    },
    async push() {
      throw error
    },
  }
}

function createTokenStore(token: string | null = "test-token"): DeviceTokenStore {
  let current = token
  return {
    getAccessToken: () => current,
    setAccessToken: (t: string) => {
      current = t
    },
  }
}

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
    vi.useFakeTimers()
  })

  afterEach(() => {
    deactivateCloudSync()
    vi.useRealTimers()
  })

  describe("activation", () => {
    it("calls setSyncProvider on activateCloudSync", () => {
      const client = createFakeClient()
      const tokenStore = createTokenStore()
      activateCloudSync({ tokenStore, client })
      // The provider is now registered via setSyncProvider.
      expect(getSyncProvider()).toBeDefined()
    })

    it("sets initial state to idle", () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      expect(getState()).toBe("idle")
    })
  })

  describe("workspace:opened — happy path", () => {
    it("triggers pull for cloud workspace", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      await handleWorkspaceOpened(cloudWorkspace)
      expect(client.pullCount).toBe(1)
    })

    it("triggers pull for team workspace", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      await handleWorkspaceOpened(teamWorkspace)
      expect(client.pullCount).toBe(1)
    })

    it("emits syncing then idle on successful pull", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      const states: string[] = []
      const { subscribe } = await import("../cloud-state")
      const unsub = subscribe((s) => states.push(s))

      const pullPromise = handleWorkspaceOpened(cloudWorkspace)
      // State should be syncing immediately.
      expect(getState()).toBe("syncing")
      await pullPromise
      expect(getState()).toBe("idle")
      expect(states).toEqual(["syncing", "idle"])
      unsub()
    })
  })

  describe("workspace:edit-committed — happy path", () => {
    it("triggers debounced push for cloud workspace", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      handleEditCommitted(cloudWorkspace)
      // Not yet pushed (debounce).
      expect(client.pushCount).toBe(0)
      vi.advanceTimersByTime(2000)
      expect(client.pushCount).toBe(1)
    })

    it("resets debounce on rapid edits", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(1000)
      handleEditCommitted(cloudWorkspace) // reset timer
      vi.advanceTimersByTime(1000)
      expect(client.pushCount).toBe(0) // still waiting
      vi.advanceTimersByTime(1000)
      expect(client.pushCount).toBe(1) // pushed after full 2s from last edit
    })

    it("emits syncing then idle on successful push", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      const states: string[] = []
      const { subscribe } = await import("../cloud-state")
      const unsub = subscribe((s) => states.push(s))

      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(2000)
      // Allow the push promise to resolve.
      await Promise.resolve()
      expect(getState()).toBe("idle")
      expect(states).toContain("syncing")
      expect(states).toContain("idle")
      unsub()
    })
  })

  describe("exclusions — local-only workspaces", () => {
    it("skips pull for local-only workspace", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      await handleWorkspaceOpened(localOnlyWorkspace)
      expect(client.pullCount).toBe(0)
    })

    it("skips push for local-only workspace", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      handleEditCommitted(localOnlyWorkspace)
      vi.advanceTimersByTime(2000)
      expect(client.pushCount).toBe(0)
    })
  })

  describe("negative — error handling", () => {
    it("emits error state on pull failure", async () => {
      const client = createFailingClient(new Error("network down"))
      activateCloudSync({ tokenStore: createTokenStore(), client })
      await handleWorkspaceOpened(cloudWorkspace)
      expect(getState()).toBe("error")
    })

    it("emits error state on push failure", async () => {
      const client = createFailingClient(new Error("token revoked"))
      activateCloudSync({ tokenStore: createTokenStore(), client })
      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(2000)
      await Promise.resolve()
      expect(getState()).toBe("error")
    })

    it("does not push if provider not activated", async () => {
      // No activateCloudSync called.
      handleEditCommitted(cloudWorkspace)
      vi.advanceTimersByTime(2000)
      // No error thrown, just a warning logged.
      expect(getState()).toBe("idle")
    })
  })

  describe("deactivation", () => {
    it("clears pending push timer on deactivate", async () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      handleEditCommitted(cloudWorkspace)
      deactivateCloudSync()
      vi.advanceTimersByTime(2000)
      expect(client.pushCount).toBe(0)
    })

    it("resets state to idle on deactivate", () => {
      const client = createFakeClient()
      activateCloudSync({ tokenStore: createTokenStore(), client })
      deactivateCloudSync()
      expect(getState()).toBe("idle")
    })
  })
})
