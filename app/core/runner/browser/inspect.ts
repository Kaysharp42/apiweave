import type { Page } from "playwright-core"
import { capturePage, within } from "./capture"
import { withoutQuery } from "./step"

/** How often, and for how long at most, inspect checks that the page has stopped changing. */
const SETTLE_INTERVAL_MS = 500
const SETTLE_MAX_MS = 3_000

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
 * Wait until the page stops changing, at most {@link SETTLE_MAX_MS}. A step
 * passes as soon as its own action is done, but a click that signs in
 * navigates a moment later, and a page fills in once its data arrives: read at
 * once, the inspection would show the page before either. Settled means two
 * ARIA snapshots {@link SETTLE_INTERVAL_MS} apart agree.
 */
async function settle(page: Page): Promise<void> {
  const read = (): Promise<string> => within(page.locator("body").ariaSnapshot({ timeout: 1_000 }), 1_500, "")
  let previous = await read()
  for (let waited = 0; waited < SETTLE_MAX_MS; waited += SETTLE_INTERVAL_MS) {
    await page.waitForTimeout(SETTLE_INTERVAL_MS).catch(() => undefined)
    await within(page.waitForLoadState("load", { timeout: SETTLE_MAX_MS }), SETTLE_MAX_MS, undefined)
    const next = await read()
    if (next === previous) return
    previous = next
  }
}
