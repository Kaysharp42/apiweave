import { chromium } from "playwright-core"
import type { BrowserChannel } from "@shared/types/BrowserChannel"
import { BrowserChannelSchema } from "@shared/zod-schemas/BrowserChannelSchema"

/** The longest one candidate may take to start before the next is tried. */
const LAUNCH_TIMEOUT_MS = 30_000

/**
 * For the hook that calls `findTestBrowser`: up to three launches, each slow
 * when a CI runner is busy with the rest of the suite.
 */
export const BROWSER_SEARCH_TIMEOUT_MS = 3 * LAUNCH_TIMEOUT_MS + 10_000

/** For a test that drives a real browser: a loaded runner is several times slower than a desk machine. */
export const BROWSER_TEST_TIMEOUT_MS = 60_000

/**
 * The browser the browser-step tests run in: `APIWEAVE_TEST_BROWSER` when set
 * (and then it must start), else the first of Playwright's Chromium, Chrome
 * and Edge that starts. Playwright's Chromium comes first because it is the
 * same build wherever it is installed and carries no vendor services: an Edge
 * enrolled in a managed account syncs its identity and cloud policy on the
 * browser's own thread, which stalls a page for seconds at random and fails
 * steps whose timeouts these tests keep short. Undefined skips those tests,
 * so `npm test` passes on a machine with none of them.
 */
export async function findTestBrowser(): Promise<BrowserChannel | undefined> {
  const forced = process.env["APIWEAVE_TEST_BROWSER"]
  const candidates: readonly BrowserChannel[] = forced ? [BrowserChannelSchema.parse(forced)] : ["chromium", "chrome", "msedge"]
  for (const channel of candidates) {
    try {
      const browser = await chromium.launch({ headless: true, timeout: LAUNCH_TIMEOUT_MS, ...(channel === "chromium" ? {} : { channel }) })
      await browser.close()
      return channel
    } catch (error) {
      if (forced) throw error
    }
  }
  return undefined
}
