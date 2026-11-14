import type { BrowserChannel } from "@shared/types/BrowserChannel"

/** Tried in the order Settings > Browser lists them. */
const CHANNELS: readonly BrowserChannel[] = ["chrome", "msedge", "chromium"]

/**
 * Which Chromium-family browsers start on this machine, in preference order.
 *
 * The only honest test is a launch: an installed Chrome can still be blocked by
 * policy, and `chromium` exists only after `npx playwright install chromium`.
 * `chromium.launch` is given no `channel`, which is what selects Playwright's
 * own build. Playwright is loaded lazily, like the run session does, so nothing
 * pays for it until Settings > Browser asks.
 */
export async function detectInstalledBrowsers(): Promise<BrowserChannel[]> {
  const { chromium } = await import("playwright-core")
  const results = await Promise.all(
    CHANNELS.map(async (channel) => {
      try {
        const browser = await chromium.launch({ headless: true, ...(channel === "chromium" ? {} : { channel }) })
        await browser.close()
        return channel
      } catch {
        return undefined
      }
    }),
  )
  return results.filter((channel): channel is BrowserChannel => channel !== undefined)
}
