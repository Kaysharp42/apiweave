import type { CDPSession, Dialog, Locator, Page } from "playwright-core"
import { describeLocator } from "@shared/browser/describe_locator"
import type { BrowserLocator } from "@shared/types/BrowserLocator"
import type { BrowserNodeData } from "@shared/types/BrowserNodeData"
import type { BrowserStepResult } from "@shared/types/BrowserStepResult"
import { SECRET_PLACEHOLDER, redactUrlForRunHistory } from "../../services/secret_utils"
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

/** The page's own DevTools session, and the ids that tell its tab from any other. */
interface TabWatch {
  readonly session: CDPSession
  readonly targetId: string
  readonly browserContextId: string | undefined
}

const tabWatches = new WeakMap<Page, Promise<TabWatch>>()

function tabWatch(page: Page): Promise<TabWatch> {
  const known = tabWatches.get(page)
  if (known !== undefined) return known
  const watch = page
    .context()
    .newCDPSession(page)
    .then(async (session) => {
      const { targetInfo } = await session.send("Target.getTargetInfo")
      return { session, targetId: targetInfo.targetId, browserContextId: targetInfo.browserContextId }
    })
  tabWatches.set(page, watch)
  // A failed start is not kept, so the next step asks again.
  watch.catch(() => tabWatches.delete(page))
  return watch
}

/**
 * Close every tab or window the page's browser context holds besides the page
 * itself, and say whether there was one. Steps drive one page in a context of
 * the run's own, so any other tab was opened by the step that just ran.
 * Chromium is asked directly because it lists a new tab by the time the click
 * that opened it returns, while Playwright's `popup` event waits for the new
 * tab's first page to load: a slow one let the step pass.
 */
async function closeOpenedTabs(page: Page): Promise<boolean> {
  const { session, targetId, browserContextId } = await tabWatch(page)
  const { targetInfos } = await session.send("Target.getTargets")
  const opened = targetInfos.filter(
    (target) => target.type === "page" && target.browserContextId === browserContextId && target.targetId !== targetId,
  )
  await Promise.all(opened.map((target) => session.send("Target.closeTarget", { targetId: target.targetId }).catch(() => undefined)))
  return opened.length > 0
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

/**
 * An expect-text or expect-value check: poll what `read` takes from the element
 * at `where` until it compares to `expected` by `match`. `noun` names that part
 * of the element in the failure.
 */
function expectElementRead(
  ctx: BrowserStepContext,
  read: (timeoutMs: number) => Promise<string>,
  expected: string,
  match: "equals" | "contains" | "matches",
  timeout: number,
  where: string,
  noun: "text" | "value",
): Promise<Compared> {
  return expectRead(
    read,
    (actual) => compareText(ctx, actual, expected, match),
    timeout,
    expected,
    (actual) =>
      actual === undefined
        ? `${where} was not found within ${seconds(timeout)}`
        : `the ${noun} of ${where} did not ${MATCH_VERBS[match]} the expected ${noun} within ${seconds(timeout)}`,
  )
}

/** Whitespace as `selectOption` compares it: one space, no leading or trailing run. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, " ").trim()
}

/** Whether an option's value or visible label is the requested value, whitespace aside. */
function optionMatches(option: { value: string; label: string }, value: string): boolean {
  const wanted = collapseWhitespace(value)
  return collapseWhitespace(option.value) === wanted || collapseWhitespace(option.label) === wanted
}

/** What a native <select> holds, read in the page: whether it is multiple, and each selected option. */
function readSelected(element: Element): { multiple: boolean; options: Array<{ value: string; label: string }> } | undefined {
  // Playwright's own actions retarget a label to its control, but `evaluate`
  // runs on the element the locator matched: a `<label for=…>` locator must be
  // followed to the control the step actually selected.
  const control = element instanceof HTMLLabelElement ? element.control : element
  if (!(control instanceof HTMLSelectElement)) return undefined
  return {
    multiple: control.multiple,
    options: Array.from(control.selectedOptions, (option) => ({ value: option.value, label: option.label })),
  }
}

/** A navigation the selection itself started, which destroys the context the read-back runs in. */
function isNavigationDuringRead(error: unknown): boolean {
  return error instanceof Error && /Execution context was destroyed|Execution context is not available/i.test(error.message)
}

/**
 * Playwright's `selectOption` returns once it has dispatched its events, so a
 * page whose change handler puts the old value back still reports success.
 * Read the <select> back until it holds the requested options, each matched by
 * value or label as `selectOption` matched it.
 *
 * A single select holds one option however many were asked for — Playwright
 * picks the first match — so one of the requested values is enough; a
 * multi-select must hold exactly the requested set. A change handler that
 * navigates destroys the context the read would use, and that is the page
 * acting on the selection, so it passes.
 */
async function expectSelected(
  element: Locator,
  values: readonly string[],
  where: string,
  timeout: number,
  navigated: () => boolean,
): Promise<Compared> {
  const expected = values.join(", ")
  let held: { multiple: boolean; options: Array<{ value: string; label: string }> } | undefined
  const { passed } = await pollUntil(
    timeout,
    async (remaining) => {
      try {
        held = await element.evaluate(readSelected, undefined, { timeout: Math.min(remaining, POLL_READ_MAX_MS) })
      } catch (error) {
        // A navigating handler destroys the context, or — once the page has
        // replaced the form — leaves the locator nothing to resolve. Either way
        // the page acted on the selection rather than reverting it.
        if (isNavigationDuringRead(error) || navigated()) return true
        throw error
      }
      if (held === undefined && navigated()) return true
      const current = held
      if (current === undefined) return false
      const matched = (option: { value: string; label: string }, value: string): boolean => optionMatches(option, value)
      if (!current.multiple) return current.options.some((option) => values.some((value) => matched(option, value)))
      return (
        values.every((value) => current.options.some((option) => matched(option, value))) &&
        current.options.every((option) => values.some((value) => matched(option, value)))
      )
    },
    isFatal,
  )
  const actual = held === undefined ? undefined : held.options.map((option) => option.label).join(", ")
  if (passed) return actual !== undefined ? { expected, actual } : { expected }
  throw new StepFailure(
    `${where} did not hold the selected option within ${seconds(timeout)}: the page changed it back, or it is not a native <select>`,
    { expected, ...(actual !== undefined ? { actual } : {}) },
  )
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
      // What was typed, so a value that resolved to "" shows. A secret or a
      // password is never written here, even one too short for the masker.
      return { actual: secret || password ? SECRET_PLACEHOLDER : value }
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
    case "select": {
      const values = config.values.map((value) => resolveValue(ctx, value, false))
      const element = locate(config.locator)
      // The whole step shares one deadline: a read-back that started its own
      // full timeout would let a slow selection double the step's wait.
      const deadline = Date.now() + timeout
      const urlBefore = page.url()
      await element.selectOption(values, { timeout })
      return expectSelected(
        element,
        values,
        describeLocator(config.locator),
        Math.max(1, deadline - Date.now()),
        () => page.url() !== urlBefore,
      )
    }
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
      return expectElementRead(
        ctx,
        async (readTimeout) => normalizeText(await element.innerText({ timeout: readTimeout })),
        expected,
        match,
        timeout,
        describeLocator(config.locator),
        "text",
      )
    }
    case "expect-value": {
      const element = locate(config.locator)
      return expectElementRead(
        ctx,
        (readTimeout) => element.inputValue({ timeout: readTimeout }),
        resolveValue(ctx, config.value, false),
        config.match ?? "equals",
        timeout,
        describeLocator(config.locator),
        "value",
      )
    }
    case "expect-url": {
      const match = config.match ?? "contains"
      const expected = resolveValue(ctx, config.url, false)
      return expectRead(
        async () => page.url(),
        (actual) => compareText(ctx, actual, expected, match),
        timeout,
        redactUrlForRunHistory(expected),
        () => `the page URL did not ${MATCH_VERBS[match]} the expected URL within ${seconds(timeout)}`,
        redactUrlForRunHistory,
      )
    }
    case "extract": {
      const value = await extractValue(page, config, locate, timeout)
      ctx.setVariable(config.variable, value)
      return { actual: config.from === "url" ? redactUrlForRunHistory(value) : value }
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

/**
 * Why a Playwright action timed out, from its call log, in words that carry no
 * page content. "Not found" is a claim the call log must support: Playwright
 * logs `waiting for <locator>` before the first resolve attempt and
 * `locator resolved to <element>` only once the selector matched, so a log
 * that never got past waiting is the one case where the element truly was
 * not there. Anything else — the element existed but never became actionable,
 * or a message shape we do not recognise — stays neutral, and Playwright's
 * own account rides on the result's `detail`.
 */
export function timeoutReason(message: string): string {
  if (message.includes("intercepts pointer events")) {
    return "another element covers it (if this is a visually hidden input, click its label or press Space)"
  }
  if (message.includes("element is not visible")) return "it is not visible"
  if (message.includes("element is not enabled")) return "it is disabled"
  if (message.includes("element is not editable")) return "it is not editable"
  if (message.includes("outside of the viewport")) return "it is outside the page"
  if (message.includes("element is not stable")) return "it kept moving"
  if (message.includes("waiting for") && !message.includes("locator resolved to")) return "it was not found (if an earlier step saw it, it may have closed or moved since)"
  return "it did not become ready in time (see detail)"
}

const CANDIDATES_SHOWN = 5
const CANDIDATE_MAX_CHARS = 80

/**
 * The candidates of a strict-mode violation as Playwright names them, each a
 * locator that would pick it (`getByRole('button', { name: 'Save' })`), the
 * first few and shortened. A candidate longer than the cap is left out whole
 * rather than cut: a half-name can be half a secret the run's masker only
 * matches whole, and it is still counted in the "N more" tail.
 */
function ambiguousCandidates(message: string): string[] {
  const plain = message.replace(/\u001b\[[0-9;]*m/g, "")
  const all = [...plain.matchAll(/^\s*\d+\) .*? aka (.+?)\s*$/gm)].map((match) => match[1] ?? "")
  const shown = all.filter((name) => name.length <= CANDIDATE_MAX_CHARS).slice(0, CANDIDATES_SHOWN)
  return all.length > shown.length ? [...shown, `${all.length - shown.length} more`] : shown
}

/** A Playwright error as a value-free message about this step. */
export function diagnose(error: unknown, config: BrowserNodeData, timeout: number): string {
  if (error instanceof StepFailure) return error.message
  const message = error instanceof Error ? error.message : String(error)
  const target = "locator" in config && config.locator !== undefined ? describeLocator(config.locator) : "the page"
  if (isClosed(error)) return "the browser was closed"
  if (isAmbiguous(error)) {
    const count = /resolved to (\d+) elements/.exec(message)?.[1]
    const candidates = ambiguousCandidates(message)
    const listed = candidates.length > 0 ? ` (${candidates.join("; ")})` : ""
    return `${target} matches ${count ?? "several"} elements${listed}; add hasText, nth or within to pick one`
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

/**
 * Where the page is: its redacted url and its title. Read after a
 * step, and again of the settled page when its evidence is taken, so both say
 * which page they belong to. Plain query parameters stay legible; userinfo,
 * the fragment and secret-named parameters are withheld, on top of the run's
 * own secret-value masker.
 */
export async function pageFacts(page: Page): Promise<Pick<BrowserStepResult, "url" | "title">> {
  const url = page.url()
  const title = await within(page.title(), 2_000, "")
  return { ...(url !== "" ? { url: redactUrlForRunHistory(url) } : {}), ...(title !== "" ? { title } : {}) }
}

/**
 * Run one browser step on `page`. Never throws for a failure of the step
 * itself: the outcome says whether it passed, with a value-free error and,
 * for `expect-*`, what was expected and what the page showed.
 */
export async function runBrowserStep(page: Page, config: BrowserNodeData, ctx: BrowserStepContext): Promise<BrowserStepOutcome> {
  disarmDialog(page)
  const timeout = config.timeoutMs ?? (config.action === "navigate" ? DEFAULT_NAVIGATE_TIMEOUT_MS : DEFAULT_STEP_TIMEOUT_MS)
  try {
    const compared = await perform(page, config, ctx, timeout)
    // Steps drive one page. A step that opens another would leave the next
    // steps acting on the wrong one, so the new page is closed and the step fails.
    if (await closeOpenedTabs(page)) throw new StepFailure("the step opened a new tab or window, which browser steps do not support yet")
    return { passed: true, result: { action: config.action, ...compared, ...(await pageFacts(page)) } }
  } catch (error) {
    // A step that failed may still have opened a tab; left open, it would fail the next step instead.
    if (!isClosed(error)) await closeOpenedTabs(page).catch(() => false)
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
  }
}
