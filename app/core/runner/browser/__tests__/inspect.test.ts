import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Page } from "playwright-core"
import { inspectPage } from "../inspect"

/** The bounds `settle` promises, as its module keeps them: it does not export them. */
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

/** A page that answers each ARIA read with `snapshot(read)`, counting from 0. */
function stubPage(snapshot: (read: number) => string): StubPage {
  const waits: number[] = []
  const loadTimeouts: number[] = []
  const readTimeouts: number[] = []
  let reads = 0
  const page = {
    url: () => "http://example.test/",
    title: () => Promise.resolve("Title"),
    waitForTimeout: (ms: number) => {
      waits.push(ms)
      return new Promise<void>((resolve) => setTimeout(resolve, ms))
    },
    waitForLoadState: (_state: string, options?: { timeout?: number }) => {
      loadTimeouts.push(options?.timeout ?? Number.POSITIVE_INFINITY)
      return Promise.resolve()
    },
    locator: () => ({
      ariaSnapshot: (options?: { timeout?: number }) => {
        readTimeouts.push(options?.timeout ?? Number.POSITIVE_INFINITY)
        return Promise.resolve(snapshot(reads++))
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
    // Settle spent its whole budget waiting, and not a millisecond more.
    expect(stub.waits.reduce((total, ms) => total + ms, 0)).toBe(SETTLE_MAX_MS)
    expect(stub.waits.every((ms) => ms > 0 && ms <= SETTLE_INTERVAL_MS)).toBe(true)
    // One wait per interval, so the loop spends the budget rather than running on as it used to.
    expect(stub.waits).toHaveLength(SETTLE_MAX_MS / SETTLE_INTERVAL_MS)
    // No call was given more than its cap or a timeout Playwright refuses.
    expect(stub.loadTimeouts.every((ms) => ms > 0 && ms <= SETTLE_MAX_MS)).toBe(true)
    // capturePage makes the last read, with its own larger timeout; the rest are settle's.
    expect(stub.readTimeouts.slice(0, -1).every((ms) => ms > 0 && ms <= READ_TIMEOUT_MS)).toBe(true)
  })

  it("returns at the first two snapshots that agree", async () => {
    const stub = stubPage(() => "same")
    const inspection = inspectPage(stub.page, { mask: identity, sensitiveValues: [], screenshot: false })
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(inspection).resolves.toMatchObject({ title: "Title" })
    expect(stub.waits).toEqual([SETTLE_INTERVAL_MS])
    // Two reads to settle, plus the one capturePage takes of the page it returns.
    expect(stub.readTimeouts).toHaveLength(3)
  })
})
