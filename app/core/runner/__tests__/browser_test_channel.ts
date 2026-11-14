import { chromium } from "playwright-core"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import { BrowserChannelSchema } from "@shared/zod-schemas/BrowserChannelSchema"

/**
 * The browser the browser-step tests run in: `APIWEAVE_TEST_BROWSER` when set
 * (and then it must start), else the first of Edge, Chrome and Playwright's
 * Chromium that starts. Undefined skips those tests, so `npm test` passes on a
 * machine with none of them.
 */
export async function findTestBrowser(): Promise<BrowserChannel | undefined> {
  const forced = process.env["APIWEAVE_TEST_BROWSER"]
  const candidates: readonly BrowserChannel[] = forced ? [BrowserChannelSchema.parse(forced)] : ["msedge", "chrome", "chromium"]
  for (const channel of candidates) {
    try {
      const browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) })
      await browser.close()
      return channel
    } catch (error) {
      if (forced) throw error
    }
  }
  return undefined
}
