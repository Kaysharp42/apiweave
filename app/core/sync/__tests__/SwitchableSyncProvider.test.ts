import { describe, expect, it } from "vitest"
import type { SyncProvider } from "../SyncProvider"
import { SwitchableSyncProvider } from "../SwitchableSyncProvider"

describe("SwitchableSyncProvider", () => {
  it("does not reject a completed local operation when its cloud push fails", async () => {
    const failure = new Error("fetch failed")
    const cloudProvider: SyncProvider = {
      recordMutation() {},
      async pull() {},
      async push() {
        throw failure
      },
    }
    const provider = new SwitchableSyncProvider(cloudProvider)

    await expect(provider.push()).resolves.toBeUndefined()
  })

  it("keeps pull failures observable", async () => {
    const failure = new Error("fetch failed")
    const cloudProvider: SyncProvider = {
      recordMutation() {},
      async pull() {
        throw failure
      },
      async push() {},
    }
    const provider = new SwitchableSyncProvider(cloudProvider)

    await expect(provider.pull()).rejects.toBe(failure)
  })
})
