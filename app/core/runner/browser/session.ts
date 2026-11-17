import type { Browser, BrowserContextOptions, Page } from "playwright-core"
import type { BrowserChannel } from "@shared/types/BrowserChannel"

/** How a run's browser is started. */
export interface BrowserLaunchSettings {
  /** Absent: the first of Chrome, Edge and Playwright's Chromium that starts. */
  readonly channel?: BrowserChannel
  /** False shows the browser window while the run drives it. */
  readonly headless: boolean
  /** The proxy the run's requests use, so its pages go the same way (`browserProxy`). */
  readonly proxy?: BrowserProxy
  /** Accept any TLS certificate, as `apiweave run --insecure` does for requests. */
  readonly ignoreHttpsErrors?: boolean
}

/** Playwright's proxy option: the server without credentials, and the hosts that bypass it. */
export interface BrowserProxy {
  readonly server: string
  readonly bypass?: string
  readonly username?: string
  readonly password?: string
}

/** The order an unset channel is tried in: the browsers people already have first. */
const AUTO_CHANNELS: readonly BrowserChannel[] = ["chrome", "msedge", "chromium"]

const CHANNEL_NAMES: Readonly<Record<BrowserChannel, string>> = {
  chrome: "Google Chrome",
  msedge: "Microsoft Edge",
  chromium: "Playwright Chromium",
}

/** Every browser failure message starts with this, so run history can keep it (see `safeErrorClass`). */
export const BROWSER_STEP_PREFIX = "Browser step:"

/** The browser could not be started, or was closed under a step. Its message is value-free. */
export class BrowserSessionError extends Error {
  public constructor(message: string) {
    super(`${BROWSER_STEP_PREFIX} ${message}`)
    this.name = "BrowserSessionError"
  }
}

/** Playwright's message when a channel's executable is missing, as opposed to failing to start. */
function isMissingBrowser(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /is not found at|Executable doesn't exist|distribution '[^']+' is not found/i.test(message)
}

/** The first line of a launch error, which names the cause (a policy, a crash) and never a workflow value. */
function firstLine(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return (message.split("\n").find((line) => line.trim() !== "") ?? "").trim().slice(0, 200)
}

/**
 * Load playwright-core exactly as a run does and name the browser type it
 * provides. The packaged app's smoke test calls it: a dependency left out of
 * app.asar only shows once packaged.
 */
export async function loadBrowserDriver(): Promise<string> {
  const { chromium } = await import("playwright-core")
  return chromium.name()
}

/**
 * One run's browser: launched by the first step that needs it, shared by every
 * `browser` node of the run (Call Workflow children included), and closed by
 * the executor that created it. Steps run one at a time on its single page,
 * whatever the graph does, because two steps interleaved on one page would
 * act on each other's state.
 */
export class BrowserSession {
  private pagePromise: Promise<Page> | null = null
  private browser: Browser | null = null
  private closed = false
  private queue: Promise<void> = Promise.resolve()

  public constructor(private readonly settings: BrowserLaunchSettings) {}

  /** Run `step` on the page once every step queued before it has finished, launching the browser first if needed. */
  public async run<T>(step: (page: Page) => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>((resolve) => {
      release = resolve
    })
    await previous
    try {
      return await step(await this.page())
    } finally {
      release()
    }
  }

  /** The page, if a step has already launched the browser; never launches one. */
  public async currentPage(): Promise<Page | null> {
    if (this.pagePromise === null || this.closed) return null
    try {
      return await this.pagePromise
    } catch {
      return null
    }
  }

  /** Close the browser. Safe to call more than once, and while a launch is in flight. */
  public async close(): Promise<void> {
    this.closed = true
    const browser = this.browser
    this.browser = null
    if (browser !== null) await browser.close().catch(() => undefined)
  }

  private page(): Promise<Page> {
    if (this.closed) return Promise.reject(new BrowserSessionError("the browser was closed before this step"))
    this.pagePromise ??= this.launch()
    return this.pagePromise
  }

  private async launch(): Promise<Page> {
    const browser = await launchBrowser(this.settings)
    if (this.closed) {
      await browser.close().catch(() => undefined)
      throw new BrowserSessionError("the run ended while the browser was starting")
    }
    this.browser = browser
    const context = await browser.newContext(contextOptions(this.settings))
    return context.newPage()
  }
}

/** Every page a run or a recording opens has this size, so a recording sees the layout its run will. */
export const PAGE_VIEWPORT = { width: 1280, height: 720 } as const

/** A run's or a recording's one context: the shared viewport, and certificate errors accepted when asked. */
export function contextOptions(settings: BrowserLaunchSettings): BrowserContextOptions {
  return { viewport: PAGE_VIEWPORT, ...(settings.ignoreHttpsErrors === true ? { ignoreHTTPSErrors: true } : {}) }
}

/**
 * Start the configured browser, or the first installed one when none is
 * configured. Fresh profile; nothing is downloaded.
 */
export async function launchBrowser(settings: BrowserLaunchSettings): Promise<Browser> {
  // Loaded on the first browser step, so a run (or a CLI start) without one never pays for it.
  const { chromium } = await import("playwright-core")
  const channels = settings.channel !== undefined ? [settings.channel] : AUTO_CHANNELS
  for (const channel of channels) {
    try {
      return await chromium.launch({
        headless: settings.headless,
        ...(channel === "chromium" ? {} : { channel }),
        ...(settings.proxy === undefined ? {} : { proxy: { ...settings.proxy } }),
      })
    } catch (error) {
      if (isMissingBrowser(error)) continue
      throw new BrowserSessionError(`${CHANNEL_NAMES[channel]} could not be started: ${firstLine(error)}`)
    }
  }
  throw new BrowserSessionError(
    settings.channel !== undefined
      ? `${CHANNEL_NAMES[settings.channel]} was not found on this machine. Choose another browser in Settings → Browser, or pass --browser to apiweave run.`
      : "no supported browser was found on this machine. Install Google Chrome or Microsoft Edge.",
  )
}
