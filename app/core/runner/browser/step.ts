import type { Dialog, Locator, Page } from "playwright-core"
import { describeLocator } from "@shared/browser/describe_locator"
import type { BrowserLocator } from "@shared/types/BrowserLocator"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import type { BrowserStepResult } from "@shared/types/BrowserStepResult"
import { rememberSecretField, within } from "./capture"
import { buildLocator } from "./locator"
import { pollUntil } from "./poll"
import { BROWSER_STEP_PREFIX } from "./session"

export const DEFAULT_STEP_TIMEOUT_MS = 10_000
export const DEFAULT_NAVIGATE_TIMEOUT_MS = 30_000
/** Playwright's own failure text kept on the result. */
const DETAIL_MAX_CHARS = 2_000
/** The longest a single read inside a polling `expect-*` waits before the next try. */
const POLL_READ_MAX_MS = 1_000

/** What a step needs from the run it belongs to. */
export interface BrowserStepContext {
  /** Fill placeholders. `allowSecrets` is true only for a fill's value. */
  resolve(text: string, allowSecrets: boolean): string
  /** Throws unless the run may send data to `host` (with port). */
  assertHostAllowed(host: string): void
  /** Adds a value the page was given (a password typed into a password field) to what the run's masker scrubs. */
  maskValue(value: string): void
  /** The run's sandboxed regular expressions, as the `matches` assertion operator uses them. */
  regexTest(pattern: string, text: string): Promise<boolean>
  setVariable(name: string, value: string): void
}

export interface BrowserStepOutcome {
  readonly passed: boolean
  /** Value-free, starting with `Browser step:`: names the action and the locator as written, never page content. */
  readonly error?: string
  readonly result: BrowserStepResult
}

type Compared = Pick<BrowserStepResult, "expected" | "actual">

/** A failure the step itself diagnosed. `message` is value-free; what was compared rides in `compared`. */
class StepFailure extends Error {
  public constructor(message: string, public readonly compared: Compared = {}) {
    super(message)
    this.name = "StepFailure"
  }
}

/**
 * Any `{{...}}` a resolution left in place. The executor leaves one it cannot
 * fill whatever its namespace, so a direct node reference or an unknown
 * function call reaches here as literally as `{{env.X}}` does.
 */
const UNRESOLVED_RE = /\{\{[^{}]+\}\}/
const SECRET_RE = /\{\{\s*secrets\./

/**
 * The error for a placeholder still in `value`, or undefined when none is. It
 * names the placeholder only when the step's own text contains it: a resolved
 * value that itself carries braces — a secret's own text, say — must not have
 * part of itself quoted back in an error.
 */
export function unresolvedPlaceholderFailure(value: string, source: string): string | undefined {
  const left = UNRESOLVED_RE.exec(value)?.[0]
  if (left === undefined) return undefined
  return source.includes(left) ? `${left} is not set` : "a placeholder could not be resolved"
}

/**
 * A config value with its placeholders filled. A placeholder left unresolved
 * fails the step rather than being typed or navigated to as literal braces,
 * and a secret is refused anywhere but a fill's value.
 */
function resolveValue(ctx: BrowserStepContext, text: string, allowSecrets: boolean): string {
  if (!allowSecrets && SECRET_RE.test(text)) {
    throw new StepFailure("{{secrets.*}} is only allowed in a fill step's value")
  }
  let value: string
  try {
    value = ctx.resolve(text, allowSecrets)
  } catch (error) {
    // The executor's own refusals (a rerun reading a value masked in its source run) name placeholders, never values.
    throw new StepFailure(error instanceof Error ? error.message.replace(/^Error: /, "") : String(error))
  }
  const unresolved = unresolvedPlaceholderFailure(value, text)
  if (unresolved !== undefined) throw new StepFailure(unresolved)
  return value
}

/** Collapse runs of whitespace and trim, the way Playwright's own text assertions compare. */
function normalizeText(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** `url` without its query string and fragment, which can carry tokens, as run history stores URLs. */
export function withoutQuery(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return url
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return url
  return `${parsed.origin}${parsed.pathname}${parsed.search ? "?<REDACTED>" : ""}${parsed.hash ? "#<REDACTED>" : ""}`
}

function seconds(ms: number): string {
  return `${Number((ms / 1000).toFixed(1))}s`
}

/** A dialog answer armed by an earlier step and not used yet, removed when the next step starts. */
const pendingDialogs = new WeakMap<Page, (dialog: Dialog) => void>()

/**
 * Answer the next JavaScript dialog the way the step says. The answer stays
 * armed until the next step starts, because a dialog a click opens can arrive
 * just after the click resolves. Without one Playwright dismisses dialogs.
 */
function armDialog(page: Page, answer: "accept" | "dismiss" | undefined): void {
  if (answer === undefined) return
  const handler = (dialog: Dialog): void => {
    pendingDialogs.delete(page)
    void (answer === "accept" ? dialog.accept() : dialog.dismiss()).catch(() => undefined)
  }
  pendingDialogs.set(page, handler)
  page.once("dialog", handler)
}

/** Drop a dialog answer an earlier step armed and no dialog used: the next step starts, or someone else takes the page. */
export function disarmDialog(page: Page): void {
  const handler = pendingDialogs.get(page)
  if (handler === undefined) return
  pendingDialogs.delete(page)
  page.off("dialog", handler)
}

function hostOf(url: string): string {
  try {
    return new URL(url).host
  } catch {
    return ""
  }
}

/** Refuse a step unless the run may send data to the page's host (an agent run holds its approved hosts). */
function requireHost(ctx: BrowserStepContext, host: string, what: string): void {
  try {
    ctx.assertHostAllowed(host)
  } catch {
    throw new StepFailure(`${what} ${host || "this page"} was refused: this run may only reach the hosts approved for it`)
  }
}

/**
 * The host of the frame that actually owns `element`. A locator with `frame`
 * can reach into an iframe from another host than the page around it, so the
 * page's host alone does not say where a value goes.
 */
async function ownerHost(element: Locator, timeout: number): Promise<string> {
  const handle = await element.elementHandle({ timeout })
  try {
    return hostOf((await handle.ownerFrame())?.url() ?? "")
  } finally {
    await handle.dispose().catch(() => undefined)
  }
}

function isAmbiguous(error: unknown): boolean {
  return error instanceof Error && error.message.includes("strict mode violation")
}

function isClosed(error: unknown): boolean {
  return error instanceof Error && /has been closed|Target closed/i.test(error.message)
}

/** Errors no later try can fix: the step's own diagnosis, an ambiguous locator, or a browser that is gone. */
function isFatal(error: unknown): boolean {
  return error instanceof StepFailure || isAmbiguous(error) || isClosed(error)
}

async function compareText(
  ctx: BrowserStepContext,
  actual: string,
  expected: string,
  match: "equals" | "contains" | "matches",
): Promise<boolean> {
  if (match !== "matches") return match === "equals" ? actual === expected : actual.includes(expected)
  try {
    return await ctx.regexTest(expected, actual)
  } catch (error) {
    // The sandbox's reasons (too long, invalid, timed out) name sizes, never the text.
    throw new StepFailure(`the regular expression could not be tested: ${error instanceof Error ? error.message : String(error)}`)
  }
}

const MATCH_VERBS: Readonly<Record<"equals" | "contains" | "matches", string>> = {
  equals: "equal",
  contains: "contain",
  matches: "match",
}

/**
 * Poll `read` until `accept` passes. A miss throws a `StepFailure` carrying
 * what was expected and what the page showed last, or "not found" when the
 * element never resolved.
 */
async function expectRead(
  read: (timeoutMs: number) => Promise<string>,
  accept: (actual: string) => Promise<boolean>,
  timeoutMs: number,
  expected: string,
  describeMiss: (actual: string | undefined) => string,
  shown: (actual: string) => string = (actual) => actual,
): Promise<Compared> {
  let actual: string | undefined
  const { passed } = await pollUntil(
    timeoutMs,
    async (remaining) => {
      actual = await read(Math.min(remaining, POLL_READ_MAX_MS))
      return accept(actual)
    },
    isFatal,
  )
  if (passed && actual !== undefined) return { expected, actual: shown(actual) }
  throw new StepFailure(describeMiss(actual), { expected, ...(actual !== undefined ? { actual: shown(actual) } : {}) })
}

// fallow-ignore-next-line complexity -- one case per browser action: the switch is the action table
async function perform(page: Page, config: BrowserNodeData, ctx: BrowserStepContext, timeout: number): Promise<Compared> {
  const locate = (locator: BrowserLocator): Locator => buildLocator(page, locator, (text) => resolveValue(ctx, text, false))
  switch (config.action) {
    case "navigate": {
      const url = resolveValue(ctx, config.url, false)
      let parsed: URL
      try {
        parsed = new URL(url)
      } catch {
        throw new StepFailure("navigate needs an absolute http:// or https:// URL")
      }
      if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
        throw new StepFailure("navigate needs an absolute http:// or https:// URL")
      }
      requireHost(ctx, parsed.host, "navigation to")
      await page.goto(url, { waitUntil: "load", timeout })
      return {}
    }
    case "click": {
      const element = locate(config.locator)
      armDialog(page, config.dialog)
      await element.click({
        timeout,
        ...(config.button !== undefined ? { button: config.button } : {}),
        ...(config.clickCount !== undefined ? { clickCount: config.clickCount } : {}),
        ...(config.modifiers !== undefined ? { modifiers: [...config.modifiers] } : {}),
      })
      return {}
    }
    case "fill": {
      const value = resolveValue(ctx, config.value, true)
      const element = locate(config.locator)
      const secret = SECRET_RE.test(config.value)
      if (secret) {
        requireHost(ctx, hostOf(page.url()), "typing a secret into")
        requireHost(ctx, await ownerHost(element, timeout), "typing a secret into")
      }
      const type = await element.getAttribute("type", { timeout })
      const password = type?.toLowerCase() === "password"
      // A password typed as a literal never reaches the masker through the
      // run's secrets, and the page's ARIA snapshot shows field values. The
      // screenshot cannot be masked by the masker at all, so both kinds of
      // field are remembered for it.
      if (value !== "" && (secret || password)) rememberSecretField(page, element)
      if (password && value !== "") ctx.maskValue(value)
      await element.fill(value, { timeout })
      return {}
    }
    case "press": {
      armDialog(page, config.dialog)
      if (config.locator !== undefined) await locate(config.locator).press(config.key, { timeout })
      else await page.keyboard.press(config.key)
      return {}
    }
    case "check":
      await locate(config.locator).check({ timeout })
      return {}
    case "uncheck":
      await locate(config.locator).uncheck({ timeout })
      return {}
    case "hover":
      await locate(config.locator).hover({ timeout })
      return {}
    case "select":
      await locate(config.locator).selectOption(config.values.map((value) => resolveValue(ctx, value, false)), { timeout })
      return {}
    case "expect-visible": {
      const visible = config.visible ?? true
      const expected = visible ? "visible" : "hidden"
      try {
        await locate(config.locator).waitFor({ state: visible ? "visible" : "hidden", timeout })
      } catch (error) {
        if (isFatal(error)) throw error
        throw new StepFailure(`${describeLocator(config.locator)} was not ${expected} within ${seconds(timeout)}`, {
          expected,
          actual: visible ? "not visible" : "visible",
        })
      }
      return { expected, actual: expected }
    }
    case "expect-text": {
      const match = config.match ?? "contains"
      const expected = match === "matches" ? resolveValue(ctx, config.text, false) : normalizeText(resolveValue(ctx, config.text, false))
      const element = locate(config.locator)
      const where = describeLocator(config.locator)
      return expectRead(
        async (readTimeout) => normalizeText(await element.innerText({ timeout: readTimeout })),
        (actual) => compareText(ctx, actual, expected, match),
        timeout,
        expected,
        (actual) =>
          actual === undefined
            ? `${where} was not found within ${seconds(timeout)}`
            : `the text of ${where} did not ${MATCH_VERBS[match]} the expected text within ${seconds(timeout)}`,
      )
    }
    case "expect-value": {
      const expected = resolveValue(ctx, config.value, false)
      const element = locate(config.locator)
      const where = describeLocator(config.locator)
      return expectRead(
        (readTimeout) => element.inputValue({ timeout: readTimeout }),
        async (actual) => actual === expected,
        timeout,
        expected,
        (actual) =>
          actual === undefined
            ? `${where} was not found within ${seconds(timeout)}`
            : `the value of ${where} did not equal the expected value within ${seconds(timeout)}`,
      )
    }
    case "expect-url": {
      const match = config.match ?? "contains"
      const expected = resolveValue(ctx, config.url, false)
      return expectRead(
        async () => page.url(),
        (actual) => compareText(ctx, actual, expected, match),
        timeout,
        withoutQuery(expected),
        () => `the page URL did not ${MATCH_VERBS[match]} the expected URL within ${seconds(timeout)}`,
        withoutQuery,
      )
    }
    case "extract": {
      const value = await extractValue(page, config, locate, timeout)
      ctx.setVariable(config.variable, value)
      return { actual: config.from === "url" ? withoutQuery(value) : value }
    }
  }
}

async function extractValue(
  page: Page,
  config: Extract<BrowserNodeData, { action: "extract" }>,
  locate: (locator: BrowserLocator) => Locator,
  timeout: number,
): Promise<string> {
  if (config.from === "url") return page.url()
  if (config.from === "title") return page.title()
  if (config.locator === undefined) throw new StepFailure(`extract from ${config.from} needs a locator`)
  const element = locate(config.locator)
  if (config.from === "text") return normalizeText(await element.innerText({ timeout }))
  if (config.from === "value") return element.inputValue({ timeout })
  const attribute = config.attribute ?? ""
  const value = await element.getAttribute(attribute, { timeout })
  if (value === null) throw new StepFailure(`${describeLocator(config.locator)} has no ${attribute} attribute`)
  return value
}

/** Why a Playwright action timed out, from its call log, in words that carry no page content. */
function timeoutReason(message: string): string {
  if (message.includes("intercepts pointer events")) return "another element covers it"
  if (message.includes("element is not visible")) return "it is not visible"
  if (message.includes("element is not enabled")) return "it is disabled"
  if (message.includes("element is not editable")) return "it is not editable"
  if (message.includes("outside of the viewport")) return "it is outside the page"
  if (message.includes("element is not stable")) return "it kept moving"
  return "it was not found"
}

/** A Playwright error as a value-free message about this step. */
function diagnose(error: unknown, config: BrowserNodeData, timeout: number): string {
  if (error instanceof StepFailure) return error.message
  const message = error instanceof Error ? error.message : String(error)
  const target = "locator" in config && config.locator !== undefined ? describeLocator(config.locator) : "the page"
  if (isClosed(error)) return "the browser was closed"
  if (isAmbiguous(error)) {
    const count = /resolved to (\d+) elements/.exec(message)?.[1]
    return `${target} matches ${count ?? "several"} elements; add hasText, nth or within to pick one`
  }
  const network = /net::ERR_[A-Z_]+/.exec(message)?.[0]
  if (network !== undefined) return `the page could not be loaded (${network})`
  if (error instanceof Error && error.name === "TimeoutError") {
    if (config.action === "navigate") return `the page did not finish loading within ${seconds(timeout)}`
    return `${config.action} on ${target} timed out after ${seconds(timeout)}: ${timeoutReason(message)}`
  }
  return `${config.action} failed`
}

/** Playwright's message without terminal colors, capped, for the result's `detail`. */
function detailOf(error: unknown): string | undefined {
  if (error instanceof StepFailure || !(error instanceof Error)) return undefined
  const plain = error.message.replace(/\u001b\[[0-9;]*m/g, "").trim()
  return plain.length > DETAIL_MAX_CHARS ? `${plain.slice(0, DETAIL_MAX_CHARS)}…` : plain
}

/** Where the page is after the step. */
async function pageFacts(page: Page): Promise<Pick<BrowserStepResult, "url" | "title">> {
  const url = page.url()
  const title = await within(page.title(), 2_000, "")
  return { ...(url !== "" ? { url: withoutQuery(url) } : {}), ...(title !== "" ? { title } : {}) }
}

/**
 * Run one browser step on `page`. Never throws for a failure of the step
 * itself: the outcome says whether it passed, with a value-free error and,
 * for `expect-*`, what was expected and what the page showed.
 */
export async function runBrowserStep(page: Page, config: BrowserNodeData, ctx: BrowserStepContext): Promise<BrowserStepOutcome> {
  disarmDialog(page)
  const timeout = config.timeoutMs ?? (config.action === "navigate" ? DEFAULT_NAVIGATE_TIMEOUT_MS : DEFAULT_STEP_TIMEOUT_MS)
  // Steps drive one page. A step that opens another would leave the next steps
  // acting on the wrong one, so the new page is closed and the step fails.
  let openedPopup = false
  const onPopup = (popup: Page): void => {
    openedPopup = true
    void popup.close().catch(() => undefined)
  }
  page.on("popup", onPopup)
  try {
    const compared = await perform(page, config, ctx, timeout)
    if (openedPopup) throw new StepFailure("the step opened a new tab or window, which browser steps do not support yet")
    return { passed: true, result: { action: config.action, ...compared, ...(await pageFacts(page)) } }
  } catch (error) {
    const detail = detailOf(error)
    return {
      passed: false,
      error: `${BROWSER_STEP_PREFIX} ${diagnose(error, config, timeout)}`,
      result: {
        action: config.action,
        ...(error instanceof StepFailure ? error.compared : {}),
        ...(detail !== undefined ? { detail } : {}),
        ...(isClosed(error) ? {} : await pageFacts(page)),
      },
    }
  } finally {
    page.off("popup", onPopup)
  }
}
