import type { Frame, Locator, Page } from "playwright-core"
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
 * Masking reads every frame and open shadow root; a closed shadow root cannot
 * be read from script, so text inside one is not painted over.
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

/**
 * The locators a fill typed a secret into, per page. The run's masker scrubs
 * the stored result but cannot reach the pixels, so a screenshot paints these
 * over — whatever the value's length, which matching by value cannot. Each is
 * re-resolved at screenshot time, which is what we want: a field that is gone
 * needs no paint, and one that is still there may hold the value.
 */
const secretFields = new WeakMap<Page, Locator[]>()

export function rememberSecretField(page: Page, element: Locator): void {
  const known = secretFields.get(page)
  if (known === undefined) secretFields.set(page, [element])
  else known.push(element)
}

/**
 * The remembered secret fields that still match, for the screenshot's `mask`.
 * Playwright masks with `strict: false`, so a locator that matches nothing is
 * skipped rather than failing; a locator whose frame is gone cannot be
 * resolved at all, and is dropped here so neither costs the run its screenshot.
 */
async function secretFieldMasks(page: Page): Promise<Locator[]> {
  const remembered = secretFields.get(page) ?? []
  const present = await Promise.all(
    remembered.map(async (element) => {
      try {
        return (await element.count()) > 0 ? [element] : []
      } catch {
        return []
      }
    }),
  )
  return present.flat()
}

/**
 * A JPEG of the viewport, password fields, fields a secret was typed into and
 * elements showing a sensitive value painted over. Null when the page will not
 * paint over what it must.
 *
 * A screenshot of the page is composited from every frame, so a password field
 * or a secret shown inside an iframe is as visible as one on the page: each
 * frame contributes its own masks, taken from the frame itself because
 * `page.locator` reaches only the main frame.
 */
async function maskedScreenshot(page: Page, sensitiveValues: readonly string[]): Promise<Buffer | null> {
  const values = sensitiveValues.filter((value) => value.length >= MIN_MASKED_SECRET_LENGTH)
  const frames = page.frames()
  const mask = [
    ...frames.map((frame) => frame.locator('input[type="password" i]')),
    ...(await within(secretFieldMasks(page), 2_000, [])),
  ]
  try {
    if (values.length > 0) {
      const marked = await markSensitive(frames, values)
      if (marked === null) return null
      mask.push(...marked)
    }
    return await page.screenshot({ type: "jpeg", quality: 70, timeout: 5_000, mask })
  } finally {
    if (values.length > 0) await within(clearMarks(frames), 1_000, undefined)
  }
}

/**
 * Mark every element in every frame that shows one of `values`, and return the
 * mark locator of each frame that marked something. Playwright's CSS engine
 * pierces open shadow roots, so one locator per frame covers the marks inside
 * them too.
 *
 * Null when a frame could not be read or its marks could not be kept, so no
 * screenshot is taken unmasked: a secret that may be on screen is either
 * painted over or not captured at all.
 */
async function markSensitive(frames: readonly Frame[], values: readonly string[]): Promise<Locator[] | null> {
  const counts = await Promise.all(frames.map((frame) => markFrame(frame, values)))
  if (counts.includes(null)) return null
  return frames.flatMap((frame, index) => ((counts[index] ?? 0) > 0 ? [frame.locator(`[${SENSITIVE_MARK}]`)] : []))
}

/**
 * Mark one frame's elements that show a value, and return how many were marked.
 * Null when the frame could not be read or its marks could not be kept.
 */
async function markFrame(frame: Frame, values: readonly string[]): Promise<number | null> {
  const shown = await within<string[] | null>(frame.evaluate(readShownText, SENSITIVE_MARK), 2_000, null)
  if (shown === null) return null
  const hits = shown.flatMap((text, index) => (values.some((value) => text.includes(value)) ? [index] : []))
  if (hits.length === 0) return 0
  const kept = await within(frame.evaluate(applyMarks, { mark: SENSITIVE_MARK, indexes: hits }), 1_000, false)
  return kept ? hits.length : null
}

/** Remove every mark every frame still has, so the page is left as it was. A frame that is gone has nothing to clear. */
async function clearMarks(frames: readonly Frame[]): Promise<void> {
  await Promise.all(
    frames.map((frame) => within(frame.evaluate(applyMarks, { mark: SENSITIVE_MARK, indexes: null }), 1_000, false)),
  )
}

/**
 * In the page: number every element under `body` showing text (a field's value,
 * or its own text nodes) with the mark, and return those texts in that order.
 *
 * Open shadow roots are walked, because a web component's text is in one and is
 * on screen all the same. A closed shadow root cannot be reached from script,
 * and a child frame is a document of its own, read by a call of its own.
 */
function readShownText(mark: string): string[] {
  const texts: string[] = []
  // A field's value, or an element's own text nodes. Kept apart from the walk
  // so the traversal below is a loop, a text check and a descend, not a nest.
  const shownText = (element: Element): string => {
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) return element.value
    let text = ""
    for (const child of Array.from(element.childNodes)) {
      if (child.nodeType === Node.TEXT_NODE) text += child.textContent ?? ""
    }
    return text
  }
  const walk = (root: ParentNode): void => {
    for (const element of Array.from(root.querySelectorAll("*"))) {
      const text = shownText(element)
      if (text.trim() !== "") {
        element.setAttribute(mark, String(texts.length))
        texts.push(text)
      }
      if (element.shadowRoot !== null) walk(element.shadowRoot)
    }
  }
  if (document.body !== null) walk(document.body)
  return texts
}

/**
 * In the page: keep the mark only on the elements at `indexes`, or remove it
 * from every element when `indexes` is null. Open shadow roots are walked, so a
 * mark inside one is kept and cleared with the rest.
 */
function applyMarks({ mark, indexes }: { mark: string; indexes: number[] | null }): boolean {
  const keep = indexes === null ? null : new Set(indexes.map(String))
  const marked = `[${mark}]`
  const forget = (element: Element): void => {
    if (keep === null || !keep.has(element.getAttribute(mark) ?? "")) element.removeAttribute(mark)
  }
  // An explicit stack rather than recursion: every open shadow root is pushed
  // and drained here, so the walk keeps one branch for "descend" and one for
  // "forget", not a nested closure whose depth repeats the same decisions.
  const roots: ParentNode[] = [document]
  while (roots.length > 0) {
    const root = roots.pop()!
    Array.from(root.querySelectorAll(marked)).forEach(forget)
    for (const element of Array.from(root.querySelectorAll("*"))) {
      if (element.shadowRoot !== null) roots.push(element.shadowRoot)
    }
  }
  return true
}
