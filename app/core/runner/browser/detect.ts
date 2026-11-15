import type { BrowserChannel } from "@shared/types/BrowserChannel"

/** Tried in the order Settings > Browser lists them. */
const CHANNELS: readonly BrowserChannel[] = ["chrome", "msedge", "chromium"]

/**
 * The longest one browser may take to prove it starts. All three are tried at
 * once — Playwright's own default of 180 seconds would leave Settings waiting
 * minutes on a browser that hangs instead of failing.
 */
const LAUNCH_TIMEOUT_MS = 15_000

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
        const browser = await chromium.launch({
          headless: true,
          timeout: LAUNCH_TIMEOUT_MS,
          ...(channel === "chromium" ? {} : { channel }),
        })
        try {
          return channel
        } finally {
          await browser.close().catch(() => undefined)
        }
      } catch {
        return undefined
      }
    }),
  )
  return results.filter((channel): channel is BrowserChannel => channel !== undefined)
}
