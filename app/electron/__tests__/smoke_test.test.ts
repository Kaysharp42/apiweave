import { describe, expect, it, vi } from "vitest"
import { runSmokeTest } from "../smoke_test"

const loadBrowserDriver = async (): Promise<string> => "chromium"

describe("runSmokeTest", () => {
  it("passes once the window loaded, a PTY started and the browser driver loaded", async () => {
    const spawnPty = vi.fn(async () => 4242)
    const log = vi.fn()

    await expect(runSmokeTest({ windowLoaded: Promise.resolve(true), spawnPty, loadBrowserDriver }, log)).resolves.toBe(0)
    expect(log).toHaveBeenCalledWith("PTY host started pid 4242")
    expect(log).toHaveBeenCalledWith("browser driver loaded (chromium)")
  })

  it("fails without trying the PTY host when the window did not load", async () => {
    const spawnPty = vi.fn(async () => 1)

    await expect(runSmokeTest({ windowLoaded: Promise.resolve(false), spawnPty, loadBrowserDriver }, () => {})).resolves.toBe(1)
    expect(spawnPty).not.toHaveBeenCalled()
  })

  it("fails when the PTY host cannot start a process", async () => {
    const log = vi.fn()
    const spawnPty = async (): Promise<number> => {
      throw new Error("The terminal backend did not start.")
    }

    await expect(runSmokeTest({ windowLoaded: Promise.resolve(true), spawnPty, loadBrowserDriver }, log)).resolves.toBe(1)
    expect(log).toHaveBeenCalledWith("smoke test failed: The terminal backend did not start.")
  })

  it("fails when the browser driver is missing from the package", async () => {
    const log = vi.fn()
    const missing = async (): Promise<string> => {
      throw new Error("Cannot find module 'playwright-core'")
    }

    await expect(runSmokeTest({ windowLoaded: Promise.resolve(true), spawnPty: async () => 1, loadBrowserDriver: missing }, log)).resolves.toBe(1)
    expect(log).toHaveBeenCalledWith("smoke test failed: Cannot find module 'playwright-core'")
  })

  it("fails instead of hanging when a check never settles", async () => {
    const never = new Promise<boolean>(() => {})

    await expect(runSmokeTest({ windowLoaded: never, spawnPty: async () => 1, loadBrowserDriver }, () => {}, 10)).resolves.toBe(1)
  })
})
