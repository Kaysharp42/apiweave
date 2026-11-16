import type { Locator, Page } from "playwright-core"
import { locatorFromSelector, type PickedLocator } from "./recorded"
import type { RecordingValues } from "./recording_values"
import { BrowserSessionError } from "./session"
import { disarmDialog } from "./step"

/** What picking an element ended with. */
export type PickOutcome = PickedLocator | { readonly kind: "cancelled" }

/**
 * Let the user pick one element of `page` with Playwright's pick mode: the
 * element under the pointer is highlighted with its locator, and a click picks
 * it without clicking it, so picking a Delete button deletes nothing. Cancelled
 * when the page or its browser closes, or `page.cancelPickLocator()` is called.
 */
export async function pickElement(page: Page, values: RecordingValues): Promise<PickOutcome> {
  // A replayed step may have armed an answer for a dialog it never opened.
  disarmDialog(page)
  await page.bringToFront().catch(() => undefined)
  let picked: Locator
  try {
    picked = await page.pickLocator()
  } catch {
    return { kind: "cancelled" }
  }
  return locatorFromSelector(selectorOf(picked), values)
}

/**
 * The selector a picked `Locator` holds. Playwright keeps it private
 * (`_selector`), so `playwright-core` stays pinned to an exact version and
 * `pick.test.ts` reads it from a real browser.
 */
function selectorOf(locator: Locator): string {
  const selector = (locator as unknown as { readonly _selector?: unknown })._selector
  if (typeof selector !== "string") throw new BrowserSessionError("the picked element's selector could not be read")
  return selector
}
