import type { Page } from "playwright-core"
import { within } from "./capture"

/** How often settle checks that the page has stopped changing, unless the caller asks for a tighter check. */
const SETTLE_INTERVAL_MS = 500
/** The most one ARIA snapshot read may spend: Playwright's own timeout, and the bound around it. */
const READ_TIMEOUT_MS = 1_000
const READ_MAX_MS = 1_500

/** What waiting for a page to settle leaves behind. */
export interface SettledPage {
  /**
   * The last ARIA snapshot the reads took, whether or not two agreed: the
   * freshest view of the page there is, for capture to keep rather than read
   * again. Undefined when no read could be taken at all, so the caller
   * captures as it would have without settling.
   */
  readonly ariaSnapshot?: string
}

/**
 * Wait until the page stops changing, at most `maxMs` of wall clock, and
 * return the last snapshot read. A step passes as soon as its own action is
 * done, but a click that signs in navigates a moment later, and a page fills
 * in once its data arrives: read at once, evidence would show the page
 * before either. Settled means two ARIA snapshots `intervalMs` apart agree,
 * so a stable page costs one interval: a caller that settles after every
 * step passes a short one. Every call is bounded by what is left of the
 * deadline, so a slow load or a hanging read cannot stretch the wait past it.
 *
 * Never throws: a page that is closed or navigating yields whatever the
 * reads managed, never more than the deadline, and no snapshot at all when
 * none could be read.
 */
export async function settle(page: Page, maxMs: number, intervalMs: number = SETTLE_INTERVAL_MS): Promise<SettledPage> {
  try {
    const deadline = Date.now() + maxMs
    /** Time left of the deadline, never below 1 ms: Playwright refuses a timeout of zero. */
    const left = (): number => Math.max(1, deadline - Date.now())
    const read = (): Promise<string> => {
      const budget = left()
      return within(page.locator("body").ariaSnapshot({ timeout: Math.min(READ_TIMEOUT_MS, budget) }), Math.min(READ_MAX_MS, budget), "")
    }
    /** The last read, unless no read could be taken: an empty snapshot is no evidence to reuse. */
    const latest = (snapshot: string): SettledPage => (snapshot === "" ? {} : { ariaSnapshot: snapshot })
    let previous = await read()
    while (deadline > Date.now()) {
      await page.waitForTimeout(Math.min(intervalMs, left())).catch(() => undefined)
      if (deadline <= Date.now()) return latest(previous)
      const budget = left()
      await within(page.waitForLoadState("load", { timeout: budget }), budget, undefined)
      const next = await read()
      if (next === previous) return latest(previous)
      previous = next
    }
    return latest(previous)
  } catch {
    return {}
  }
}
