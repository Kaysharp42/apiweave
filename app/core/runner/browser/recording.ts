import type { Browser, BrowserContext, Page } from "playwright-core"
import { within } from "./capture"
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep"
import {
  RecordingConverter,
  readRecorderAction,
  readRecorderSignal,
  readsField,
  type ConverterOutput,
  type RecorderAction,
} from "./recorded"
import { ariaRoleAndName, betterSelector } from "./better_selector"
import { buildLocator } from "./locator"
import { outcomeCheck, pathOf, readActionLandmarks, readLandmarks, type PageState } from "./outcome_check"
import { roleSelectorWithName } from "./selector_parse"
import type { RecordingValues } from "./recording_values"
import { BrowserSessionError, contextOptions, launchBrowser, type BrowserLaunchSettings } from "./session"
import { settle } from "./settle"
import { disarmDialog } from "./step"

/**
 * Playwright's recording API on a browser context. It is private (Playwright's
 * own code generator and MCP server call it), so `playwright-core` is pinned
 * to an exact version and the converter is tested on captured payloads.
 */
interface RecordingContext {
  _startRecording(
    params: { readonly language: string },
    sink: {
      readonly actionAdded: (page: Page, action: unknown) => void
      readonly actionUpdated: (page: Page, action: unknown) => void
      readonly signalAdded: (page: Page, signal: unknown) => void
    },
  ): Promise<void>
  _stopRecording(): Promise<void>
}

/** What a recording tells its owner. Every value in it is already a template: it may go to the renderer as it is. */
export interface RecordingListener {
  /** A new step, or a new config for a step already sent under the same `stepId`. */
  step(step: RecordedBrowserStep): void
  warning(message: string): void
  /** The recording is over, stopped or because the user closed the browser. Called once. */
  ended(): void
}

export interface RecordingOptions {
  readonly values: RecordingValues
  /** Secret names the workflow already uses, which a placeholder secret never takes. */
  readonly takenSecretNames: ReadonlySet<string>
  readonly newStepId: () => string
  readonly listener: RecordingListener
  /** The fewest milliseconds between two sends of the same step while the user types. */
  readonly throttleMs?: number
}

/** A recording in a browser of its own, from a start page. */
export interface NewRecordingOptions extends RecordingOptions {
  /** Which browser, and whether it shows: a recording is headed except in tests. */
  readonly launch: BrowserLaunchSettings
  readonly startUrl: string
}

/** How long opening the start page may take. */
const START_TIMEOUT_MS = 30_000
const DEFAULT_THROTTLE_MS = 150
/** Just past Playwright's `kActionBufferTimeout` (500 ms in its `RecorderSignalProcessor`). */
const RECORDER_BUFFER_MS = 600
/**
 * How long after a step its dialog may still count as that step's. Playwright
 * holds a click for up to 500 ms and then emits the click and its signals back
 * to back, so a dialog a click opens arrives well inside a second. A dialog
 * that arrives seconds later was opened by a timer — a session expiry, say —
 * and must not be pinned on whichever step happened to go last. Five seconds
 * is the same threshold Playwright uses to decide a navigation belongs to the
 * previous action, and leaves room for a slow page.
 */
const DIALOG_WINDOW_MS = 5_000
/** The longest a step waits for its selector to be made sturdier before keeping the recorder's. */
const IMPROVE_TIMEOUT_MS = 1_500
/**
 * How long a click or key press waits for the page to stop changing before
 * its outcome is read. Playwright already held a left click for 500 ms, so a
 * transition of a second or so has mostly happened; the interval is tight
 * because a page that did not change costs one interval.
 */
const OUTCOME_SETTLE_MS = 1_500
const OUTCOME_SETTLE_INTERVAL_MS = 150
/** The most one read of the page's landmarks, or one count of a check's elements, may take. */
const OBSERVE_TIMEOUT_MS = 1_000
const OBSERVE_MAX_MS = 1_500
/** How many of the page's last paths are kept, which is far more than a user visits in the half second one is looked up for. */
const PATHS_KEPT = 50
/** A new click or key press: what earns a check of its outcome. A click Playwright reports after a key press with no count is noise. */
function changesPage(kind: "added" | "updated", action: RecorderAction): boolean {
  return kind === "added" && (action.name === "press" || (action.name === "click" && action.clickCount !== 0))
}

/** What an abandoned recording tells its owner: nothing at all. */
const SILENT_LISTENER: RecordingListener = { step: () => undefined, warning: () => undefined, ended: () => undefined }

/**
 * One recording: a browser the user clicks through, with Playwright's in-page
 * recorder toolbar, turned into browser steps as they happen.
 *
 * Recorder events arrive synchronously and are handled one at a time, in
 * order, because a fill needs one question to the page (is this a password
 * field?) before it can be converted. The question is asked as the event
 * arrives and its answer awaited in the queue. Typing sends one update per keystroke;
 * those are sent at most once per {@link DEFAULT_THROTTLE_MS}, and a new step
 * first flushes the updates before it, so the order never changes.
 *
 * A click or key press is followed, in the same turn of the queue, by the
 * check that proves what it did (see {@link outcomeCheck}): the page is let
 * settle, read, and compared with the page as the user acted — the snapshot
 * Playwright's recorder took in the page at that moment, and the path the
 * page was on then. The next event waits in the queue meanwhile, so the check
 * always lands right after its action, and every wait is bounded, so a slow
 * page delays steps but never drops one.
 */
export class BrowserRecording {
  private queue: Promise<void> = Promise.resolve()
  /** Clicks and key presses received and not yet handled: each may change the page, so a page read while one waits shows more than one action. */
  private waitingOutcomes = 0
  /** The main page's paths, newest last, and when it reached each: what the page was on when the user acted. */
  private readonly paths: Array<{ readonly at: number; readonly path: string | null }> = []
  private mainPage: Page | null = null
  private accepting = true
  private stopping: Promise<void> | null = null
  /** When the last recorder action arrived, to tell a dialog it opened from one the page raised later. */
  private lastActionAt: number | null = null
  private readonly passwordFields = new Map<string, Promise<boolean>>()
  /** A recorded selector after it was made sturdier, by the selector Playwright wrote. */
  private readonly improvedSelectors = new Map<string, Promise<string>>()
  private readonly sentStepIds = new Set<string>()
  private readonly pending = new Map<string, RecordedBrowserStep>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly converter: RecordingConverter
  private listener: RecordingListener

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly options: RecordingOptions,
    pageAlreadyOpen: boolean,
  ) {
    this.converter = new RecordingConverter(options.values, options.newStepId, options.takenSecretNames, pageAlreadyOpen)
    this.listener = options.listener
  }

  /** Launch the browser, start recording and open the start page. Throws, with nothing left open, when any of it fails. */
  public static async start(options: NewRecordingOptions): Promise<BrowserRecording> {
    const browser = await launchBrowser(options.launch)
    let recording: BrowserRecording | null = null
    try {
      const context = await browser.newContext(contextOptions(options.launch))
      recording = new BrowserRecording(browser, context, options, false)
      await recording.listen()
      const page = await context.newPage()
      recording.watch(page)
      try {
        await page.goto(options.startUrl, { waitUntil: "load", timeout: START_TIMEOUT_MS })
      } catch (error) {
        const reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)
        throw new BrowserSessionError(`the start page could not be opened: ${reason.slice(0, 200)}`)
      }
      return recording
    } catch (error) {
      // The recorder may already have sent a step, and closing the browser fires
      // `disconnected`, which would end the recording: silence it first, or a
      // start that failed would still put steps on the canvas and report an end.
      recording?.abandon()
      await browser.close().catch(() => undefined)
      throw error
    }
  }

  /**
   * Record on a page a run left open (re-recording from a step), and own its
   * browser from now on: stopping closes it. The page is not reloaded, so the
   * first step recorded is the user's first action. Throws, with the browser
   * closed, when recording cannot start.
   */
  public static async attach(page: Page, options: RecordingOptions): Promise<BrowserRecording> {
    const context = page.context()
    const browser = context.browser()
    if (browser === null) throw new BrowserSessionError("the replayed page has no browser to record in")
    // The last replayed step may have armed an answer for a dialog it never
    // opened; left armed, it would answer the first dialog of the recording.
    disarmDialog(page)
    const recording = new BrowserRecording(browser, context, options, true)
    try {
      recording.watch(page)
      await recording.listen()
      await page.bringToFront()
      return recording
    } catch (error) {
      recording.abandon()
      await browser.close().catch(() => undefined)
      throw error
    }
  }

  /** Answer dialogs, and turn what Playwright's recorder reports into steps. */
  private async listen(): Promise<void> {
    // With nobody listening, Playwright cancels every dialog, and a confirm()
    // flow would be recorded on a page where the user's confirmation never
    // happened. OK is what a test of that flow usually means; the step
    // records it (`dialog: "accept"`), and the panel can switch it to Cancel.
    this.context.on("dialog", (dialog) => void dialog.accept().catch(() => undefined))
    await (this.context as unknown as RecordingContext)._startRecording(
      { language: "javascript" },
      {
        actionAdded: (page, action) => this.receive("added", page, action),
        actionUpdated: (page, action) => this.receive("updated", page, action),
        signalAdded: (page, signal) => this.receiveSignal(page, signal),
      },
    )
  }

  /** The page the run will drive: closing it, or the browser, ends the recording. */
  private watch(page: Page): void {
    this.mainPage ??= page
    this.paths.push({ at: Date.now(), path: pathOf(page.url()) })
    // Same-document navigations (a single-page app's pushState) count too.
    page.on("framenavigated", (frame) => {
      if (frame !== page.mainFrame()) return
      this.paths.push({ at: Date.now(), path: pathOf(frame.url()) })
      if (this.paths.length > PATHS_KEPT) this.paths.shift()
    })
    page.on("close", () => void this.stop())
    this.browser.on("disconnected", () => void this.stop())
  }

  /** The page being recorded. */
  public get page(): Page | null {
    return this.mainPage
  }

  /**
   * End the recording: handle every event already received, send what is
   * left, close the browser and tell the listener. Safe to call more than
   * once, and when the user has already closed the browser.
   */
  public stop(): Promise<void> {
    this.stopping ??= this.finish()
    return this.stopping
  }

  /**
   * Discard a recording whose start is failing. Its owner was told the start
   * failed, so nothing it has sent or still sends — a step, a warning, or the
   * end that closing the browser would report — may reach the listener.
   */
  private abandon(): void {
    this.accepting = false
    this.listener = SILENT_LISTENER
  }

  private async finish(): Promise<void> {
    // Playwright holds a left click (and a navigate) back for 500 ms to attach
    // the navigation it causes, and stopping drops what it still holds: the
    // click the user made just before pressing Stop would be lost.
    if (this.browser.isConnected() && this.mainPage !== null && !this.mainPage.isClosed()) {
      await new Promise<void>((resolve) => setTimeout(resolve, RECORDER_BUFFER_MS))
    }
    this.accepting = false
    await this.queue
    const { steps, warnings } = this.converter.finish()
    for (const warning of warnings) this.listener.warning(warning)
    for (const step of steps) this.send(step)
    this.flush()
    await within((this.context as unknown as RecordingContext)._stopRecording(), 2_000, undefined)
    await this.browser.close().catch(() => undefined)
    this.listener.ended()
  }

  private receive(kind: "added" | "updated", page: Page, raw: unknown): void {
    if (!this.accepting) return
    // The first page the recorder reports is the one the run will drive.
    this.mainPage ??= page
    const action = readRecorderAction(raw)
    if (action === null) return
    // Read here, at receipt, not in the queue: a dialog is judged on how long
    // after the action Playwright sent it, and the queue may lag behind that.
    this.lastActionAt = Date.now()
    const onMainPage = page === this.mainPage
    // Asked of the page now, not when the queue reaches the event: a click's
    // outcome check holds the queue for a moment, and by then the field may
    // be gone — a password field read too late would count as one not found.
    const isPassword = readsField(action) && onMainPage && action.selector !== undefined ? this.isPasswordField(page, action.selector) : undefined
    const selector = action.selector === undefined || !onMainPage ? undefined : this.improvedSelector(page, action.selector, action.name === "click")
    const before = changesPage(kind, action) && onMainPage ? this.pageAsActed(raw) : null
    if (changesPage(kind, action)) this.waitingOutcomes++
    this.queue = this.queue.then(() => this.handle(kind, page, action, onMainPage, isPassword, selector, before)).catch(() => undefined)
  }

  /**
   * The page as the user clicked or pressed: the landmarks in the snapshot
   * Playwright's recorder took in the page at that moment, and the path it
   * was on. The action may reach here up to half a second after it happened
   * (Playwright holds a left click that long), so the path is the one the
   * page had that long ago: a navigation since then is counted as this
   * action's.
   */
  private pageAsActed(raw: unknown): PageState | null {
    const landmarks = readActionLandmarks(raw)
    if (landmarks === null) return null
    const actedBy = Date.now() - RECORDER_BUFFER_MS
    const path = [...this.paths].reverse().find((entry) => entry.at <= actedBy)?.path ?? null
    return { path, landmarks }
  }

  /** A signal (`dialog`…) goes through the same queue, so it follows the action Playwright sent it after. */
  private receiveSignal(page: Page, raw: unknown): void {
    if (!this.accepting) return
    const name = readRecorderSignal(raw)
    if (name === null) return
    const onMainPage = page === this.mainPage
    const isRecent = this.lastActionAt !== null && Date.now() - this.lastActionAt <= DIALOG_WINDOW_MS
    this.queue = this.queue.then(() => this.report(this.converter.signal(name, onMainPage, isRecent))).catch(() => undefined)
  }

  private async handle(
    kind: "added" | "updated",
    page: Page,
    action: RecorderAction,
    onMainPage: boolean,
    passwordAnswer: Promise<boolean> | undefined,
    improved: Promise<string> | undefined,
    before: PageState | null,
  ): Promise<void> {
    if (changesPage(kind, action)) this.waitingOutcomes--
    const isPassword = await passwordAnswer
    const selector = improved === undefined ? action.selector : await improved
    const output = this.converter.apply({
      kind,
      action: selector === undefined || selector === action.selector ? action : { ...action, selector },
      onMainPage,
      ...(isPassword === undefined ? {} : { isPassword }),
    })
    this.report(output)
    if (before !== null && output.steps.length > 0) await this.checkOutcome(page, before)
  }

  /**
   * Add the check that proves what the click or key press just recorded did:
   * wait for the page to settle, then compare it with the page as the user acted.
   */
  private async checkOutcome(page: Page, before: PageState): Promise<void> {
    await settle(page, OUTCOME_SETTLE_MS, OUTCOME_SETTLE_INTERVAL_MS)
    const after = await this.observe(page)
    // Playwright reports a left click up to half a second after it happened,
    // so a click it reports in that time may have changed the page before
    // this read. Once the recording is stopping, nothing more arrives.
    if (this.accepting) await new Promise<void>((resolve) => setTimeout(resolve, RECORDER_BUFFER_MS))
    // The user clicked again: the page may show what that click did, so no
    // check here, rather than one pinned on the wrong step.
    if (after === null || this.waitingOutcomes > 0) return
    const check = outcomeCheck(before, after, this.converter.typedValues(), this.options.values)
    if (check === null) return
    if (check.probe !== null) {
      const count = await within(buildLocator(page, check.probe, (text) => text).count(), OBSERVE_MAX_MS, 0)
      if (count !== 1) return
    }
    this.report(this.converter.addCheck(check.config))
  }

  /**
   * The page's path and landmarks, read in one bounded call: null when the
   * page cannot answer. The snapshot is taken the way Playwright's recorder
   * takes the one it compares with (`mode: "ai"`, the body), and only its
   * landmarks are kept.
   */
  private async observe(page: Page): Promise<PageState | null> {
    if (page.isClosed()) return null
    const snapshot = await within(page.locator("body").ariaSnapshot({ mode: "ai", timeout: OBSERVE_TIMEOUT_MS }), OBSERVE_MAX_MS, "")
    const landmarks = snapshot === "" ? null : readLandmarks(snapshot)
    return landmarks === null ? null : { path: pathOf(page.url()), landmarks }
  }

  private report(output: ConverterOutput): void {
    for (const warning of output.warnings) this.listener.warning(warning)
    for (const step of output.steps) this.send(step)
  }

  /**
   * Whether the field behind `selector` is an `<input type="password">`, asked
   * once per field. When the page cannot say, it counts as one: a placeholder
   * secret for a field that was not a password is a nuisance, a password sent
   * as text is a leak.
   */
  private isPasswordField(page: Page, selector: string): Promise<boolean> {
    const known = this.passwordFields.get(selector)
    if (known !== undefined) return known
    const answer = page
      .locator(selector)
      .first()
      .evaluate((element) => element instanceof HTMLInputElement && element.type === "password", undefined, { timeout: 1_000 })
    const isPassword = within(answer, 1_500, true)
    this.passwordFields.set(selector, isPassword)
    return isPassword
  }

  /**
   * The selector made sturdier, asked once per selector, and never blocking a
   * step for long: a page that cannot answer leaves the selector as the
   * recorder wrote it. A bare role gets its accessible name; a fragile
   * selector — kept whole, or CSS leaning on a position or a text filter — is
   * swapped for a role, label or exact text that finds the same one element
   * (see {@link betterSelector}).
   */
  private improvedSelector(page: Page, selector: string, isClick: boolean): Promise<string> {
    const known = this.improvedSelectors.get(selector)
    if (known !== undefined) return known
    const improved = selector.startsWith("internal:role=")
      ? within(this.accessibleName(page, selector), IMPROVE_TIMEOUT_MS, "").then((name) => roleSelectorWithName(selector, name) ?? selector)
      : within(betterSelector(page, selector, isClick), IMPROVE_TIMEOUT_MS, selector)
    this.improvedSelectors.set(selector, improved)
    return improved
  }

  /** The accessible name in the element's ARIA snapshot. */
  private async accessibleName(page: Page, selector: string): Promise<string> {
    const snapshot = await page.locator(selector).first().ariaSnapshot({ timeout: 1_000 })
    return ariaRoleAndName(snapshot)?.name ?? ""
  }

  private send(step: RecordedBrowserStep): void {
    if (!this.sentStepIds.has(step.stepId)) {
      this.sentStepIds.add(step.stepId)
      this.flush()
      this.listener.step(step)
      return
    }
    this.pending.set(step.stepId, step)
    this.timer ??= setTimeout(() => this.flush(), this.options.throttleMs ?? DEFAULT_THROTTLE_MS)
  }

  private flush(): void {
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    const steps = [...this.pending.values()]
    this.pending.clear()
    for (const step of steps) this.listener.step(step)
  }
}
