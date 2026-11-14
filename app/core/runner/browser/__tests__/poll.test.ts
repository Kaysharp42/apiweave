import { describe, expect, it } from "vitest"
import { pollUntil } from "../poll"

const never = (): boolean => false

describe("pollUntil", () => {
  it("passes as soon as the check does", async () => {
    let tries = 0
    const outcome = await pollUntil(1_000, async () => ++tries === 3, never, 5)
    expect(outcome).toEqual({ passed: true, lastError: undefined })
    expect(tries).toBe(3)
  })

  it("gives up at the deadline and keeps the last error", async () => {
    const started = Date.now()
    const outcome = await pollUntil(120, async () => {
      throw new Error("not attached")
    }, never, 20)
    expect(outcome.passed).toBe(false)
    expect(String(outcome.lastError)).toContain("not attached")
    expect(Date.now() - started).toBeLessThan(500)
  })

  it("forgets an earlier error once a check runs cleanly", async () => {
    let tries = 0
    const outcome = await pollUntil(80, async () => {
      tries += 1
      if (tries === 1) throw new Error("flaky")
      return false
    }, never, 10)
    expect(outcome).toEqual({ passed: false, lastError: undefined })
  })

  it("rethrows an error no later try can fix", async () => {
    let tries = 0
    await expect(pollUntil(1_000, async () => {
      tries += 1
      throw new Error("strict mode violation")
    }, (error) => String(error).includes("strict"), 5)).rejects.toThrow("strict mode violation")
    expect(tries).toBe(1)
  })

  it("tells each check how long it may wait", async () => {
    const budgets: number[] = []
    await pollUntil(50, async (remaining) => {
      budgets.push(remaining)
      return false
    }, never, 10)
    expect(budgets[0]).toBeLessThanOrEqual(50)
    expect(budgets.every((budget) => budget >= 1)).toBe(true)
  })
})
