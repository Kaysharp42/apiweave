import type { Page } from "playwright-core"
import { capturePage, within } from "./capture"
import { settle } from "./settle"
import { withoutQuery } from "./step"

/** How long inspect waits for the page a run left open to settle. */
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
  const settled = await settle(page, SETTLE_MAX_MS)
  const title = await within(page.title(), 2_000, "")
  // The snapshot settle ended on is the page as settled; keep it rather than read the page again.
  const capture = await capturePage(page, options.sensitiveValues, {
    screenshot: options.screenshot,
    ...(settled.ariaSnapshot !== undefined ? { ariaSnapshot: settled.ariaSnapshot } : {}),
  })
  return {
    url: options.mask(withoutQuery(page.url())),
    title: options.mask(title),
    ...(capture.ariaSnapshot !== undefined ? { ariaSnapshot: options.mask(capture.ariaSnapshot) } : {}),
    ...(capture.screenshot !== undefined ? { screenshot: capture.screenshot } : {}),
    ...(capture.note !== undefined ? { note: capture.note } : {}),
  }
}
