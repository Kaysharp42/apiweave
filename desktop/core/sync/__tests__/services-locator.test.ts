import { afterEach, describe, expect, it } from "vitest"
import { LocalOnlySyncProvider } from "../LocalOnlySyncProvider"
import type { SyncProvider } from "../SyncProvider"
import { getSyncProvider, resetSyncProvider, setSyncProvider } from "../../services-locator"

describe("service-locator SyncProvider singleton", () => {
  afterEach(() => resetSyncProvider())

  it("defaults to LocalOnlySyncProvider", () => {
    resetSyncProvider()
    expect(getSyncProvider()).toBeInstanceOf(LocalOnlySyncProvider)
  })

  it("returns the same instance on subsequent gets", () => {
    resetSyncProvider()
    expect(getSyncProvider()).toBe(getSyncProvider())
  })

  it("setSyncProvider overrides the singleton and removeSyncProvider reseeds it", () => {
    const custom: SyncProvider = {
      async pull() {},
      async push() {},
    }
    setSyncProvider(custom)
    expect(getSyncProvider()).toBe(custom)
    resetSyncProvider()
    expect(getSyncProvider()).toBeInstanceOf(LocalOnlySyncProvider)
  })
})
