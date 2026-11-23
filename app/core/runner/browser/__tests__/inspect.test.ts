import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Page } from "playwright-core"
import { inspectPage } from "../inspect"

/** The bounds settle promises, as its module keeps them: it does not export them. */
const SETTLE_MAX_MS = 3_000
const SETTLE_INTERVAL_MS = 500
const READ_TIMEOUT_MS = 1_000

const identity = <T>(value: T): T => value

interface StubPage {
  readonly page: Page
  /** Every `waitForTimeout` this page was asked for, in ms. */
  readonly waits: number[]
  /** Every `waitForLoadState` timeout asked of it, in ms. */
  readonly loadTimeouts: number[]
  /** Every ARIA read's Playwright timeout, in ms. */
  readonly readTimeouts: number[]
}

/**
 * A page that answers each ARIA read with `snapshot(read)`, counting from 0.
 * `dead` makes every read and wait fail the way a closed page's do.
 */
function stubPage(snapshot: (read: number) => string, dead = false): StubPage {
  const waits: number[] = []
  const loadTimeouts: number[] = []
  const readTimeouts: number[] = []
  let reads = 0
  const reject = (): Promise<never> => Promise.reject(new Error("Target page, context or browser has been closed"))
  const page = {
    url: () => "http://example.test/",
    title: () => Promise.resolve("Title"),
    waitForTimeout: (ms: number) => {
      waits.push(ms)
      return dead ? reject() : new Promise<void>((resolve) => setTimeout(resolve, ms))
    },
    waitForLoadState: (_state: string, options?: { timeout?: number }) => {
      loadTimeouts.push(options?.timeout ?? Number.POSITIVE_INFINITY)
      return dead ? reject() : Promise.resolve()
    },
    locator: () => ({
      ariaSnapshot: (options?: { timeout?: number }) => {
        readTimeouts.push(options?.timeout ?? Number.POSITIVE_INFINITY)
        return dead ? reject() : Promise.resolve(snapshot(reads++))
      },
    }),
  }
  return { page: page as unknown as Page, waits, loadTimeouts, readTimeouts }
}

describe("inspectPage", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("stops settling at the deadline when the page keeps changing", async () => {
    const stub = stubPage((read) => `snapshot ${read}`)
    const inspection = inspectPage(stub.page, { mask: identity, sensitiveValues: [], screenshot: false })
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(inspection).resolves.toMatchObject({ title: "Title", url: "http://example.test/" })
    // The inspection keeps the last page settle read, not a fresh one.
    await expect(inspection).resolves.toMatchObject({ ariaSnapshot: "snapshot 5" })
    // Settle spent its whole budget waiting, and not a millisecond more.
    expect(stub.waits.reduce((total, ms) => total + ms, 0)).toBe(SETTLE_MAX_MS)
    expect(stub.waits.every((ms) => ms > 0 && ms <= SETTLE_INTERVAL_MS)).toBe(true)
    // One wait per interval, so the loop spends the budget rather than running on as it used to.
    expect(stub.waits).toHaveLength(SETTLE_MAX_MS / SETTLE_INTERVAL_MS)
    // No call was given more than its cap or a timeout Playwright refuses.
    expect(stub.loadTimeouts.every((ms) => ms > 0 && ms <= SETTLE_MAX_MS)).toBe(true)
    // Every read is settle's: capturePage keeps its snapshot instead of reading the page again.
    expect(stub.readTimeouts.every((ms) => ms > 0 && ms <= READ_TIMEOUT_MS)).toBe(true)
  })

  it("returns at the first two snapshots that agree", async () => {
    const stub = stubPage(() => "same")
    const inspection = inspectPage(stub.page, { mask: identity, sensitiveValues: [], screenshot: false })
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(inspection).resolves.toMatchObject({ title: "Title", ariaSnapshot: "same" })
    expect(stub.waits).toEqual([SETTLE_INTERVAL_MS])
    // Two reads to settle; capturePage keeps the one they agreed on rather than read again.
    expect(stub.readTimeouts).toHaveLength(2)
  })

  it("captures as it always did when the page cannot be read", async () => {
    const stub = stubPage(() => "never", true)
    const inspection = inspectPage(stub.page, { mask: identity, sensitiveValues: [], screenshot: false })
    await vi.advanceTimersByTimeAsync(30_000)

    const inspected = await inspection
    // Settle read nothing twice, agreed on that, and said so by giving no
    // snapshot; capturePage then tried a read of its own and could not take it either.
    expect(inspected.ariaSnapshot).toBeUndefined()
    expect(inspected.note).toBe("The ARIA snapshot could not be taken.")
    expect(stub.readTimeouts).toHaveLength(3)
  })
})
