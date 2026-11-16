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
import type { RecordingValues } from "./recording_values"
import { BrowserSessionError, launchBrowser, PAGE_VIEWPORT, type BrowserLaunchSettings } from "./session"

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
  /** Which browser, and whether it shows: a recording is headed except in tests. */
  readonly launch: BrowserLaunchSettings
  readonly startUrl: string
  readonly values: RecordingValues
  /** Secret names the workflow already uses, which a placeholder secret never takes. */
  readonly takenSecretNames: ReadonlySet<string>
  readonly newStepId: () => string
  readonly listener: RecordingListener
  /** The fewest milliseconds between two sends of the same step while the user types. */
  readonly throttleMs?: number
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
/** What an abandoned recording tells its owner: nothing at all. */
const SILENT_LISTENER: RecordingListener = { step: () => undefined, warning: () => undefined, ended: () => undefined }

/**
 * One recording: a browser the user clicks through, with Playwright's in-page
 * recorder toolbar, turned into browser steps as they happen.
 *
 * Recorder events arrive synchronously and are handled one at a time, in
 * order, because a fill needs one question to the page (is this a password
 * field?) before it can be converted. Typing sends one update per keystroke;
 * those are sent at most once per {@link DEFAULT_THROTTLE_MS}, and a new step
 * first flushes the updates before it, so the order never changes.
 */
export class BrowserRecording {
  private queue: Promise<void> = Promise.resolve()
  private mainPage: Page | null = null
  private accepting = true
  private stopping: Promise<void> | null = null
  /** When the last recorder action arrived, to tell a dialog it opened from one the page raised later. */
  private lastActionAt: number | null = null
  private readonly passwordFields = new Map<string, boolean>()
  private readonly sentStepIds = new Set<string>()
  private readonly pending = new Map<string, RecordedBrowserStep>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly converter: RecordingConverter
  private listener: RecordingListener

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly options: RecordingOptions,
  ) {
    this.converter = new RecordingConverter(options.values, options.newStepId, options.takenSecretNames)
    this.listener = options.listener
  }

  /** Launch the browser, start recording and open the start page. Throws, with nothing left open, when any of it fails. */
  public static async start(options: RecordingOptions): Promise<BrowserRecording> {
    const browser = await launchBrowser(options.launch)
    let recording: BrowserRecording | null = null
    try {
      const context = await browser.newContext({ viewport: PAGE_VIEWPORT })
      recording = new BrowserRecording(browser, context, options)
      const started = recording
      // With nobody listening, Playwright cancels every dialog, and a confirm()
      // flow would be recorded on a page where the user's confirmation never
      // happened. OK is what a test of that flow usually means; the step
      // records it (`dialog: "accept"`), and the panel can switch it to Cancel.
      context.on("dialog", (dialog) => void dialog.accept().catch(() => undefined))
      await (context as unknown as RecordingContext)._startRecording(
        { language: "javascript" },
        {
          actionAdded: (page, action) => started.receive("added", page, action),
          actionUpdated: (page, action) => started.receive("updated", page, action),
          signalAdded: (page, signal) => started.receiveSignal(page, signal),
        },
      )
      const page = await context.newPage()
      started.mainPage ??= page
      page.on("close", () => void started.stop())
      browser.on("disconnected", () => void started.stop())
      try {
        await page.goto(options.startUrl, { waitUntil: "load", timeout: START_TIMEOUT_MS })
      } catch (error) {
        const reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)
        throw new BrowserSessionError(`the start page could not be opened: ${reason.slice(0, 200)}`)
      }
      return started
    } catch (error) {
      // The recorder may already have sent a step, and closing the browser fires
      // `disconnected`, which would end the recording: silence it first, or a
      // start that failed would still put steps on the canvas and report an end.
      recording?.abandon()
      await browser.close().catch(() => undefined)
      throw error
    }
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
    this.queue = this.queue.then(() => this.handle(kind, page, action, onMainPage)).catch(() => undefined)
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

  private async handle(kind: "added" | "updated", page: Page, action: RecorderAction, onMainPage: boolean): Promise<void> {
    const isPassword =
      readsField(action) && onMainPage && action.selector !== undefined ? await this.isPasswordField(page, action.selector) : undefined
    this.report(this.converter.apply({ kind, action, onMainPage, ...(isPassword === undefined ? {} : { isPassword }) }))
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
  private async isPasswordField(page: Page, selector: string): Promise<boolean> {
    const known = this.passwordFields.get(selector)
    if (known !== undefined) return known
    const answer = page
      .locator(selector)
      .first()
      .evaluate((element) => element instanceof HTMLInputElement && element.type === "password", undefined, { timeout: 1_000 })
    const isPassword = await within(answer, 1_500, true)
    this.passwordFields.set(selector, isPassword)
    return isPassword
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
