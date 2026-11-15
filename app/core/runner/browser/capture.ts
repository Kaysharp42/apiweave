import type { Page } from "playwright-core"
import { MIN_MASKED_SECRET_LENGTH } from "../secret_masker"

/** The ARIA snapshot kept on a failed step's result. */
export const ARIA_SNAPSHOT_MAX_CHARS = 64 * 1024
/** A screenshot is dropped above this, whether stored or sent to an agent. */
export const SCREENSHOT_MAX_BYTES = 1024 * 1024

/** Set on the elements a screenshot paints over, then removed. */
const SENSITIVE_MARK = "data-apiweave-sensitive"

/** Resolves to `fallback` if `promise` takes longer than `ms`, so evidence never hangs a run. */
export function within<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), ms)
  })
  return Promise.race([promise.catch(() => fallback), timeout]).finally(() => clearTimeout(timer))
}

/** What the page looks like: its ARIA snapshot and a JPEG of the viewport, or a note saying what could not be taken. */
export interface PageCapture {
  readonly ariaSnapshot?: string
  readonly screenshot?: Buffer
  readonly note?: string
}

/**
 * The page's ARIA snapshot, capped, and a screenshot with password fields and
 * every element showing one of `sensitiveValues` painted over. Best effort and
 * bounded in time: a page that is gone or stuck yields what could be taken,
 * with a note.
 *
 * The ARIA snapshot shows typed field values, passwords included: it must go
 * through the run's masker, which also knows every password a fill typed.
 * The screenshot cannot be masked afterwards, so it is masked as it is taken.
 */
export async function capturePage(
  page: Page,
  sensitiveValues: readonly string[],
  options: { readonly screenshot: boolean } = { screenshot: true },
): Promise<PageCapture> {
  const notes: string[] = []
  const snapshot = await within(page.locator("body").ariaSnapshot({ timeout: 2_000 }), 3_000, "")
  if (snapshot === "") notes.push("The ARIA snapshot could not be taken.")
  const screenshot = options.screenshot ? await within(maskedScreenshot(page, sensitiveValues), 8_000, null) : undefined
  if (screenshot === null) notes.push("The screenshot could not be taken.")
  else if (screenshot !== undefined && screenshot.length > SCREENSHOT_MAX_BYTES) notes.push("The screenshot was larger than 1 MB and was not kept.")
  return {
    ...(snapshot !== ""
      ? { ariaSnapshot: snapshot.length > ARIA_SNAPSHOT_MAX_CHARS ? `${snapshot.slice(0, ARIA_SNAPSHOT_MAX_CHARS)}\n… (truncated)` : snapshot }
      : {}),
    ...(screenshot != null && screenshot.length <= SCREENSHOT_MAX_BYTES ? { screenshot } : {}),
    ...(notes.length > 0 ? { note: notes.join(" ") } : {}),
  }
}

/** A JPEG of the viewport, password fields and elements showing a sensitive value painted over. Null when the page will not paint over what it must. */
async function maskedScreenshot(page: Page, sensitiveValues: readonly string[]): Promise<Buffer | null> {
  const values = sensitiveValues.filter((value) => value.length >= MIN_MASKED_SECRET_LENGTH)
  const mask = [page.locator('input[type="password" i]')]
  try {
    if (values.length > 0) {
      const marked = await markSensitive(page, values)
      if (marked === null) return null
      if (marked > 0) mask.push(page.locator(`[${SENSITIVE_MARK}]`))
    }
    return await page.screenshot({ type: "jpeg", quality: 70, timeout: 5_000, mask })
  } finally {
    if (values.length > 0) await within(page.evaluate(clearMarks, SENSITIVE_MARK), 1_000, undefined)
  }
}

/**
 * Mark every element that shows one of `values`: a field holding it, or an
 * element whose own text contains it. The values never enter the page, whose
 * scripts could read them: the page's text is read out and compared here.
 * Null when the page could not be read, so no screenshot is taken unmasked.
 */
async function markSensitive(page: Page, values: readonly string[]): Promise<number | null> {
  const shown = await within<string[] | null>(page.evaluate(readShownText, SENSITIVE_MARK), 2_000, null)
  if (shown === null) return null
  const hits = shown.flatMap((text, index) => (values.some((value) => text.includes(value)) ? [index] : []))
  if (hits.length === 0) return 0
  const kept = await within(page.evaluate(keepMarks, { mark: SENSITIVE_MARK, indexes: hits }), 1_000, false)
  return kept ? hits.length : null
}

/**
 * In the page: number every element showing text (a field's value, or its own
 * text nodes) with the mark, and return those texts in that order.
 */
function readShownText(mark: string): string[] {
  const texts: string[] = []
  for (const element of Array.from(document.querySelectorAll("body *"))) {
    let text = ""
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      text = element.value
    } else {
      for (const child of Array.from(element.childNodes)) {
        if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? ""
      }
    }
    if (text.trim() === "") continue
    element.setAttribute(mark, String(texts.length))
    texts.push(text)
  }
  return texts
}

/** In the page: keep the mark only on the elements at `indexes`. */
function keepMarks({ mark, indexes }: { mark: string; indexes: number[] }): boolean {
  const keep = new Set(indexes.map(String))
  for (const element of Array.from(document.querySelectorAll(`[${mark}]`))) {
    if (!keep.has(element.getAttribute(mark) ?? "")) element.removeAttribute(mark)
  }
  return true
}

/** In the page: remove every mark. */
function clearMarks(mark: string): void {
  for (const element of Array.from(document.querySelectorAll(`[${mark}]`))) element.removeAttribute(mark)
}
