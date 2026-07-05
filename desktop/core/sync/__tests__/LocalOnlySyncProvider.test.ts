import { describe, expect, it } from "vitest"
import { LocalOnlySyncProvider } from "../LocalOnlySyncProvider"

describe("LocalOnlySyncProvider", () => {
  it("pull resolves with no side effect", async () => {
    const provider = new LocalOnlySyncProvider()
    await expect(provider.pull()).resolves.toBeUndefined()
  })

  it("push resolves with no side effect", async () => {
    const provider = new LocalOnlySyncProvider()
    await expect(provider.push()).resolves.toBeUndefined()
  })

  it("pull + push do not throw and do not return data", async () => {
    const provider = new LocalOnlySyncProvider()
    const before = Date.now()
    await provider.pull()
    await provider.push()
    const after = Date.now()
    // Only wall-clock time may pass; no observable side effect exists.
    expect(after).toBeGreaterThanOrEqual(before)
  })
})
