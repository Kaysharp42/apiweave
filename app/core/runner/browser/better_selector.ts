import type { ElementHandle, Locator, Page } from "playwright-core"
import { BrowserAriaRoleSchema } from "@shared/zod-schemas/BrowserLocatorSchema"
import {
  exactHasText,
  exactTextSelector,
  isFragileSelector,
  labelSelector,
  placeholderSelector,
  roleSelector,
} from "./selector_parse"

/** How long one question to the page may take; the caller bounds the whole search. */
const QUERY_TIMEOUT_MS = 500

/**
 * The ancestors a click on an inner element is really aimed at: a control or
 * an interactive role. The nearest one wins.
 */
const INTERACTIVE_ANCESTOR =
  "xpath=ancestor::*[self::button or self::a[@href] or self::select or " +
  ["button", "link", "menuitem", "menuitemcheckbox", "menuitemradio", "tab", "option", "checkbox", "radio", "switch", "combobox", "treeitem"]
    .map((role) => `@role='${role}'`)
    .join(" or ") +
  "][1]"

/** The role and accessible name in an ARIA snapshot's first line: `- heading "Orders" [level=1]`. */
export function ariaRoleAndName(snapshot: string): { readonly role: string; readonly name: string } | null {
  const first = snapshot.split("\n", 1)[0] ?? ""
  const quoted = /^-\s+([a-z]+)\s+"((?:[^"\\]|\\.)*)"/.exec(first)
  if (quoted === null) return null
  try {
    const name: unknown = JSON.parse(`"${quoted[2] ?? ""}"`)
    return typeof name === "string" ? { role: quoted[1] ?? "", name } : null
  } catch {
    // An escape JSON does not know: not a name this can reproduce exactly.
    return null
  }
}

/** `getByRole` selectors for what `locator`'s ARIA snapshot calls it: the substring match first, then the exact one. */
async function roleCandidates(locator: Locator): Promise<string[]> {
  const parsed = ariaRoleAndName(await locator.ariaSnapshot({ timeout: QUERY_TIMEOUT_MS }))
  if (parsed === null || !BrowserAriaRoleSchema.safeParse(parsed.role).success) return []
  return [roleSelector(parsed.role, parsed.name, false), roleSelector(parsed.role, parsed.name, true)].filter(
    (candidate): candidate is string => candidate !== null,
  )
}

/** What the element is labelled by, as `getByLabel`/`getByPlaceholder` selectors. */
async function labelCandidates(target: ElementHandle): Promise<string[]> {
  const names = await target.evaluate((element) => {
    if (!(element instanceof Element)) return { labels: [], placeholder: "" }
    const labels = "labels" in element && element.labels instanceof NodeList ? [...element.labels].map((label) => label.textContent ?? "") : []
    return {
      labels: [...labels, element.getAttribute("aria-label") ?? ""],
      placeholder: element.getAttribute("placeholder") ?? "",
    }
  })
  return [
    ...names.labels.flatMap((label) => [labelSelector(label, false), labelSelector(label, true)]),
    placeholderSelector(names.placeholder, false),
    placeholderSelector(names.placeholder, true),
  ].filter((candidate): candidate is string => candidate !== null)
}

/** `getByText(…, { exact: true })` from the recorder's own `/^X$/`, else from the element's whole text. */
async function textCandidates(selector: string, target: ElementHandle): Promise<string[]> {
  const fromRegex = exactHasText(selector)
  const text = fromRegex ?? (await target.evaluate((element) => (element.textContent ?? "").replace(/\s+/g, " ").trim()))
  const candidate = exactTextSelector(text)
  return candidate === null ? [] : [candidate]
}

/** The first candidate that finds exactly one element, and that element is `element`. */
async function firstMatching(page: Page, candidates: readonly string[], element: ElementHandle): Promise<string | null> {
  for (const candidate of candidates) {
    const locator = page.locator(candidate)
    if ((await locator.count()) !== 1) continue
    if (await locator.evaluate((found, expected) => found === expected, element, { timeout: QUERY_TIMEOUT_MS })) return candidate
  }
  return null
}

/**
 * A sturdier selector for the element a fragile recorded one finds (see
 * {@link isFragileSelector}), or the recorded selector unchanged.
 *
 * Tried in order: the role and name the element's own ARIA snapshot gives it;
 * what labels it (a `<label>`, `aria-label` or placeholder); for a click, the
 * role and name of the control it sits in; and its exact text. A candidate is
 * taken only when it finds one element on the page now, and that element is
 * the one the recorder picked — for a click the control around it, which is
 * what a run then clicks. Anything the page cannot answer keeps the recorded
 * selector: a worse locator is better than a step lost to a slow page.
 *
 * The caller bounds the whole search in time.
 */
export async function betterSelector(page: Page, selector: string, isClick: boolean): Promise<string> {
  if (!isFragileSelector(selector)) return selector
  return findBetter(page, selector, isClick).catch(() => selector)
}

async function findBetter(page: Page, selector: string, isClick: boolean): Promise<string> {
  const recorded = page.locator(selector)
  // Strict: a recorded selector that finds several elements names no one element to keep.
  const target = await recorded.elementHandle({ timeout: QUERY_TIMEOUT_MS })
  try {
    const own = (await firstMatching(page, await roleCandidates(recorded), target)) ?? (await firstMatching(page, await labelCandidates(target), target))
    if (own !== null) return own
    const control = isClick ? await controlAround(page, recorded) : null
    if (control !== null) return control
    return (await firstMatching(page, await textCandidates(selector, target), target)) ?? selector
  } finally {
    await target.dispose()
  }
}

/** A `getByRole` selector for the control a clicked element sits in, or null when it sits in none or the control has no unique name. */
async function controlAround(page: Page, recorded: Locator): Promise<string | null> {
  const around = recorded.locator(INTERACTIVE_ANCESTOR)
  if ((await around.count()) !== 1) return null
  const control = await around.elementHandle({ timeout: QUERY_TIMEOUT_MS })
  try {
    return await firstMatching(page, await roleCandidates(around), control)
  } finally {
    await control.dispose()
  }
}
