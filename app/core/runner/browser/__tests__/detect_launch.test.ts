import { beforeEach, describe, expect, it, vi } from "vitest"
import { detectInstalledBrowsers } from "../detect"

/** What the mocked Playwright saw, reset before each test. */
const harness = vi.hoisted(() => ({
  launched: [] as Array<{ channel?: string; timeout?: number; headless?: boolean }>,
  closed: [] as string[],
  launchFails: new Set<string>(),
  closeFails: new Set<string>(),
  reset(): void {
    harness.launched = []
    harness.closed = []
    harness.launchFails.clear()
    harness.closeFails.clear()
  },
}))

vi.mock("playwright-core", () => ({
  chromium: {
    launch: async (options: { channel?: string; timeout?: number; headless?: boolean }): Promise<{ close(): Promise<void> }> => {
      const channel = options.channel ?? "chromium"
      harness.launched.push(options)
      if (harness.launchFails.has(channel)) throw new Error(`${channel} is not found at /missing`)
      return {
        close: async (): Promise<void> => {
          harness.closed.push(channel)
          if (harness.closeFails.has(channel)) throw new Error("close failed")
        },
      }
    },
  },
}))

beforeEach(() => harness.reset())

describe("detectInstalledBrowsers", () => {
  it("launches each candidate with a short timeout and closes every browser that started", async () => {
    const installed = await detectInstalledBrowsers()

    expect(installed).toEqual(["chrome", "msedge", "chromium"])
    expect(harness.launched).toEqual([
      { headless: true, timeout: 15_000, channel: "chrome" },
      { headless: true, timeout: 15_000, channel: "msedge" },
      { headless: true, timeout: 15_000 },
    ])
    expect(harness.closed).toEqual(["chrome", "msedge", "chromium"])
  })

  it("reports only the browsers that start", async () => {
    harness.launchFails.add("msedge")

    const installed = await detectInstalledBrowsers()

    expect(installed).toEqual(["chrome", "chromium"])
    expect(harness.closed).toEqual(["chrome", "chromium"])
  })

  it("still reports a browser whose close fails", async () => {
    harness.closeFails.add("chrome")

    const installed = await detectInstalledBrowsers()

    expect(installed).toEqual(["chrome", "msedge", "chromium"])
    expect(harness.closed).toEqual(["chrome", "msedge", "chromium"])
  })
})
