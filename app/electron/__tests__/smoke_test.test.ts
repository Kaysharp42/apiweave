import { describe, expect, it, vi } from "vitest"
import { runSmokeTest } from "../smoke_test"

describe("runSmokeTest", () => {
  it("passes once the window loaded and a PTY started", async () => {
    const spawnPty = vi.fn(async () => 4242)
    const log = vi.fn()

    await expect(runSmokeTest({ windowLoaded: Promise.resolve(true), spawnPty }, log)).resolves.toBe(0)
    expect(log).toHaveBeenCalledWith("PTY host started pid 4242")
  })

  it("fails without trying the PTY host when the window did not load", async () => {
    const spawnPty = vi.fn(async () => 1)

    await expect(runSmokeTest({ windowLoaded: Promise.resolve(false), spawnPty }, () => {})).resolves.toBe(1)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it("fails when the PTY host cannot start a process", async () => {
    const log = vi.fn()
    const spawnPty = async (): Promise<number> => {
      throw new Error("The terminal backend did not start.")
    }

    await expect(runSmokeTest({ windowLoaded: Promise.resolve(true), spawnPty }, log)).resolves.toBe(1)
    expect(log).toHaveBeenCalledWith("smoke test failed: The terminal backend did not start.")
  })

  it("fails instead of hanging when a check never settles", async () => {
    const never = new Promise<boolean>(() => {})

    await expect(runSmokeTest({ windowLoaded: never, spawnPty: async () => 1 }, () => {}, 10)).resolves.toBe(1)
  })
})
