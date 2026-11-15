import type { Browser, BrowserContext, Page } from "playwright-core"
import { within } from "./capture"
import type { RecordedBrowserStep } from "@shared/types/RecordedBrowserStep"
import { RecordingConverter, readRecorderAction, type RecorderAction } from "./recorded"
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
  private readonly passwordFields = new Map<string, boolean>()
  private readonly sentStepIds = new Set<string>()
  private readonly pending = new Map<string, RecordedBrowserStep>()
  private timer: ReturnType<typeof setTimeout> | null = null
  private readonly converter: RecordingConverter

  private constructor(
    private readonly browser: Browser,
    private readonly context: BrowserContext,
    private readonly options: RecordingOptions,
  ) {
    this.converter = new RecordingConverter(options.values, options.newStepId, options.takenSecretNames)
  }

  /** Launch the browser, start recording and open the start page. Throws, with nothing left open, when any of it fails. */
  public static async start(options: RecordingOptions): Promise<BrowserRecording> {
    const browser = await launchBrowser(options.launch)
    try {
      const context = await browser.newContext({ viewport: PAGE_VIEWPORT })
      const recording = new BrowserRecording(browser, context, options)
      await (context as unknown as RecordingContext)._startRecording(
        { language: "javascript" },
        {
          actionAdded: (page, action) => recording.receive("added", page, action),
          actionUpdated: (page, action) => recording.receive("updated", page, action),
        },
      )
      const page = await context.newPage()
      recording.mainPage ??= page
      page.on("close", () => void recording.stop())
      browser.on("disconnected", () => void recording.stop())
      try {
        await page.goto(options.startUrl, { waitUntil: "load", timeout: START_TIMEOUT_MS })
      } catch (error) {
        const reason = error instanceof Error ? (error.message.split("\n")[0] ?? "") : String(error)
        throw new BrowserSessionError(`the start page could not be opened: ${reason.slice(0, 200)}`)
      }
      return recording
    } catch (error) {
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

  private async finish(): Promise<void> {
    // Playwright holds a left click (and a navigate) back for 500 ms to attach
    // the navigation it causes, and stopping drops what it still holds: the
    // click the user made just before pressing Stop would be lost.
    if (this.browser.isConnected() && this.mainPage !== null && !this.mainPage.isClosed()) {
      await new Promise<void>((resolve) => setTimeout(resolve, RECORDER_BUFFER_MS))
    }
    this.accepting = false
    await this.queue
    const { steps } = this.converter.finish()
    for (const step of steps) this.send(step)
    this.flush()
    await within((this.context as unknown as RecordingContext)._stopRecording(), 2_000, undefined)
    await this.browser.close().catch(() => undefined)
    this.options.listener.ended()
  }

  private receive(kind: "added" | "updated", page: Page, raw: unknown): void {
    if (!this.accepting) return
    // The first page the recorder reports is the one the run will drive.
    this.mainPage ??= page
    const action = readRecorderAction(raw)
    if (action === null) return
    const onMainPage = page === this.mainPage
    this.queue = this.queue.then(() => this.handle(kind, page, action, onMainPage)).catch(() => undefined)
  }

  private async handle(kind: "added" | "updated", page: Page, action: RecorderAction, onMainPage: boolean): Promise<void> {
    const isPassword =
      action.name === "fill" && onMainPage && action.selector !== undefined ? await this.isPasswordField(page, action.selector) : undefined
    const output = this.converter.apply({ kind, action, onMainPage, ...(isPassword === undefined ? {} : { isPassword }) })
    for (const warning of output.warnings) this.options.listener.warning(warning)
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
      this.options.listener.step(step)
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
    for (const step of steps) this.options.listener.step(step)
  }
}
