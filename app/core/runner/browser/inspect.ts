import type { Page } from "playwright-core"
import { capturePage, within } from "./capture"
import { withoutQuery } from "./step"

/** How often, and for how long at most, inspect checks that the page has stopped changing. */
const SETTLE_INTERVAL_MS = 500
const SETTLE_MAX_MS = 3_000
/** The most one ARIA snapshot read may spend: Playwright's own timeout, and the bound around it. */
const READ_TIMEOUT_MS = 1_000
const READ_MAX_MS = 1_500

/** The page a run left open, as `browser_inspect` returns it: every string already through the run's masker. */
export interface InspectedPage {
  /** Query string and fragment redacted, as run history stores URLs. */
  readonly url: string
  readonly title: string
  readonly ariaSnapshot?: string
  /** Password fields and every element showing a masked value painted over. */
  readonly screenshot?: Buffer
  readonly note?: string
}

/**
 * Read the page a run left open. `mask` is the run's masker: the ARIA
 * snapshot shows typed field values, and the title or URL can show anything
 * the page was given.
 */
export async function inspectPage(
  page: Page,
  options: {
    readonly mask: <T>(value: T) => T
    readonly sensitiveValues: readonly string[]
    readonly screenshot: boolean
  },
): Promise<InspectedPage> {
  await settle(page)
  const title = await within(page.title(), 2_000, "")
  const capture = await capturePage(page, options.sensitiveValues, { screenshot: options.screenshot })
  return {
    url: options.mask(withoutQuery(page.url())),
    title: options.mask(title),
    ...(capture.ariaSnapshot !== undefined ? { ariaSnapshot: options.mask(capture.ariaSnapshot) } : {}),
    ...(capture.screenshot !== undefined ? { screenshot: capture.screenshot } : {}),
    ...(capture.note !== undefined ? { note: capture.note } : {}),
  }
}

/**
 * Wait until the page stops changing, at most {@link SETTLE_MAX_MS} of wall
 * clock. A step passes as soon as its own action is done, but a click that
 * signs in navigates a moment later, and a page fills in once its data
 * arrives: read at once, the inspection would show the page before either.
 * Settled means two ARIA snapshots {@link SETTLE_INTERVAL_MS} apart agree.
 * Every call is bounded by what is left of the deadline, so a slow load or a
 * hanging read cannot stretch the wait past it.
 */
async function settle(page: Page): Promise<void> {
  const deadline = Date.now() + SETTLE_MAX_MS
  /** Time left of the deadline, never below 1 ms: Playwright refuses a timeout of zero. */
  const left = (): number => Math.max(1, deadline - Date.now())
  const read = (): Promise<string> => {
    const budget = left()
    return within(page.locator("body").ariaSnapshot({ timeout: Math.min(READ_TIMEOUT_MS, budget) }), Math.min(READ_MAX_MS, budget), "")
  }
  let previous = await read()
  while (deadline > Date.now()) {
    await page.waitForTimeout(Math.min(SETTLE_INTERVAL_MS, left())).catch(() => undefined)
    if (deadline <= Date.now()) return
    const budget = left()
    await within(page.waitForLoadState("load", { timeout: budget }), budget, undefined)
    const next = await read()
    if (next === previous) return
    previous = next
  }
}
