import { beforeAll, describe, expect, it } from "vitest"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import { BROWSER_SEARCH_TIMEOUT_MS, BROWSER_TEST_TIMEOUT_MS, findTestBrowser } from "../../__tests__/browser_test_channel"
import { detectInstalledBrowsers } from "../detect"

/** The order detect() tries and reports in. */
const PREFERENCE: readonly BrowserChannel[] = ["chrome", "msedge", "chromium"]

let available: BrowserChannel | undefined

beforeAll(async () => {
  available = await findTestBrowser()
}, BROWSER_SEARCH_TIMEOUT_MS)

describe("detectInstalledBrowsers", () => {
  it("reports each browser that starts, once, in preference order", { timeout: BROWSER_TEST_TIMEOUT_MS }, async (context) => {
    // No Chromium-family browser on this machine: nothing to detect.
    if (available === undefined) context.skip()

    const installed = await detectInstalledBrowsers()
    expect(installed).toContain(available)
    expect(new Set(installed).size).toBe(installed.length)
    const positions = installed.map((channel) => PREFERENCE.indexOf(channel))
    expect(positions).toEqual([...positions].sort((left, right) => left - right))
  })
})
