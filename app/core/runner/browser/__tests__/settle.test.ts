import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Page } from "playwright-core"
import { settle } from "../settle"

/** The bounds settle promises, as its module keeps them: it does not export them. */
const SETTLE_INTERVAL_MS = 500
const READ_TIMEOUT_MS = 1_000

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
 * `dead` makes every read and wait fail the way a closed page's do, and a
 * `dead` page is closed; `closed` says so for a page whose reads still answer.
 */
function stubPage(snapshot: (read: number) => string, dead = false, closed = dead): StubPage {
  const waits: number[] = []
  const loadTimeouts: number[] = []
  const readTimeouts: number[] = []
  let reads = 0
  const reject = (): Promise<never> => Promise.reject(new Error("Target page, context or browser has been closed"))
  const page = {
    isClosed: () => closed,
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

describe("settle", () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it("returns the snapshot two reads agreed on, one interval apart", async () => {
    const stub = stubPage(() => "same")
    const settled = settle(stub.page, 1_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ ariaSnapshot: "same", settled: true, unreadable: false })
    expect(stub.waits).toEqual([SETTLE_INTERVAL_MS])
    // Every read stays inside its own cap and the time the deadline had left.
    expect(stub.readTimeouts).toEqual([1_000, 500])
    expect(stub.loadTimeouts).toEqual([500])
  })

  it("spends only the cap it is given on a page that never settles, and keeps the last read", async () => {
    const stub = stubPage((read) => `snapshot ${read}`)
    const settled = settle(stub.page, 1_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ ariaSnapshot: "snapshot 1", settled: false, unreadable: false })
    // One wait per interval, so the loop spends the budget rather than running on.
    expect(stub.waits).toEqual([SETTLE_INTERVAL_MS, SETTLE_INTERVAL_MS])
    expect(stub.waits.reduce((total, ms) => total + ms, 0)).toBe(1_000)
    expect(stub.readTimeouts.every((ms) => ms > 0 && ms <= READ_TIMEOUT_MS)).toBe(true)
  })

  it("checks at the interval it is given, so a stable page costs only that", async () => {
    const stub = stubPage(() => "same")
    const settled = settle(stub.page, 1_000, 150)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ ariaSnapshot: "same", settled: true, unreadable: false })
    expect(stub.waits).toEqual([150])
  })

  it("keeps checking at the given interval until the page agrees or the cap runs out", async () => {
    const stub = stubPage((read) => (read < 3 ? `snapshot ${read}` : "arrived"))
    const settled = settle(stub.page, 1_000, 150)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ ariaSnapshot: "arrived", settled: true, unreadable: false })
    expect(stub.waits).toEqual([150, 150, 150, 150])
  })

  it("honours a cap shorter than one interval, where no second read can be compared", async () => {
    const stub = stubPage((read) => `snapshot ${read}`)
    const settled = settle(stub.page, 300)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ ariaSnapshot: "snapshot 0", settled: false, unreadable: true })
    expect(stub.waits).toEqual([300])
  })

  it("keeps the snapshot it had when a later read finds nothing, and calls it unreadable", async () => {
    // A read that runs out of budget answers nothing. That is no reason to
    // throw away the page the first read did see — and it is not evidence that
    // the page changed, so it must not be reported as still changing.
    const stub = stubPage((read) => (read === 0 ? "before" : ""))
    const settled = settle(stub.page, 1_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ ariaSnapshot: "before", settled: false, unreadable: true })
    expect(stub.waits).toEqual([SETTLE_INTERVAL_MS, SETTLE_INTERVAL_MS])
  })

  it("calls a slow snapshot that used the settle budget unreadable, not still changing", async () => {
    const page = {
      isClosed: () => false,
      waitForTimeout: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      waitForLoadState: () => Promise.resolve(),
      locator: () => ({
        ariaSnapshot: () => new Promise<string>((resolve) => setTimeout(() => resolve("slow"), 600)),
      }),
    }
    const settled = settle(page as unknown as Page, 1_000, 150)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ ariaSnapshot: "slow", settled: false, unreadable: true })
  })

  it("calls a page whose snapshot throws unreadable, never still changing", async () => {
    const page = {
      isClosed: () => false,
      waitForTimeout: (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
      waitForLoadState: () => Promise.resolve(),
      locator: () => ({ ariaSnapshot: () => Promise.reject(new Error("page is gone")) }),
    }
    const settled = settle(page as unknown as Page, 1_000, 150)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ settled: false, unreadable: true })
  })

  it("does not call two empty reads a settled page while the page is still open", async () => {
    const stub = stubPage(() => "")
    const settled = settle(stub.page, 1_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ settled: false, unreadable: true })
    // Silence is not agreement: settle spends its cap rather than stopping
    // after the first interval, during which a slow navigation would be cut.
    expect(stub.waits.reduce((total, ms) => total + ms, 0)).toBe(1_000)
    expect(stub.waits.length).toBeGreaterThan(1)
  })

  it("stops waiting when the page has closed, keeping the last real snapshot", async () => {
    // A closed page's reads stay empty, which is not agreement. Only the
    // close ends the wait early: watching it would learn nothing more.
    const stub = stubPage((read) => (read === 0 ? "before" : ""), false, true)
    const settled = settle(stub.page, 60_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ ariaSnapshot: "before", settled: false, unreadable: true })
    expect(stub.waits).toEqual([SETTLE_INTERVAL_MS])
    expect(stub.readTimeouts).toHaveLength(2)
  })

  it("reports no snapshot when no read could be taken, without throwing", async () => {
    const stub = stubPage(() => "never", true)
    const settled = settle(stub.page, 3_000)
    await vi.advanceTimersByTimeAsync(30_000)

    // Reads of a closed page take nothing, and the close is what ends the
    // wait: it says so rather than watching a deadline that cannot help.
    await expect(settled).resolves.toEqual({ settled: false, unreadable: true })
    expect(stub.readTimeouts).toHaveLength(2)
    expect(stub.waits).toEqual([SETTLE_INTERVAL_MS])
  })

  it("swallows a page that throws on every call", async () => {
    const page = {
      waitForTimeout: (): Promise<void> => {
        throw new Error("closed")
      },
      waitForLoadState: (): Promise<void> => {
        throw new Error("closed")
      },
      locator: (): object => {
        throw new Error("closed")
      },
    }
    const settled = settle(page as unknown as Page, 1_000)
    await vi.advanceTimersByTimeAsync(30_000)

    await expect(settled).resolves.toEqual({ settled: false, unreadable: true })
  })
})
