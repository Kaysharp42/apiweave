import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getLogger } from "../utils/logger"

type Level = "debug" | "info" | "warn" | "error"

interface SentRecord {
  data: unknown[]
  level: string
}

/**
 * Stands in for the `window.__electronLog` global that electron-log's
 * injected preload exposes: per-level methods forwarding to the main process.
 */
function installBridge(sendToMain: (message: SentRecord) => void): void {
  const bridge: Record<string, unknown> = {}
  for (const level of ["debug", "info", "warn", "error", "verbose", "silly"]) {
    bridge[level] = (...data: unknown[]): void => sendToMain({ data, level })
  }
  ;(window as unknown as Record<string, unknown>).__electronLog = bridge
}

describe("getLogger (renderer)", () => {
  let sent: SentRecord[]

  beforeEach(() => {
    vi.restoreAllMocks()
    sent = []
    installBridge((message) => sent.push(message))
  })

  afterEach(() => {
    delete (window as unknown as Record<string, unknown>).__electronLog
  })

  it("forwards records over the electron-log bridge when it is present", () => {
    const log = getLogger("SidebarStore")

    log.warn("error fetching workflows", { status: 500 })

    expect(sent).toEqual([{ level: "warn", data: ["[SidebarStore] error fetching workflows", { status: 500 }] }])
  })

  it("maps each level onto the matching bridge call", () => {
    const log = getLogger("levels")

    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")
    const levels = sent.map((r) => r.level)

    expect(levels).toEqual<Level[]>(["debug", "info", "warn", "error"])
  })

  it("falls back to the browser console when the bridge is absent", () => {
    // No __electronLog: plain vitest/jsdom or a preload that has not run yet.
    delete (window as unknown as Record<string, unknown>).__electronLog
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

    getLogger("live-updates").error("ignoring malformed workflow snapshot", new Error("bad shape"))

    expect(sent).toHaveLength(0)
    expect(errorSpy).toHaveBeenCalledOnce()
    expect(errorSpy.mock.calls[0]?.[0]).toBe("[live-updates] ignoring malformed workflow snapshot")
    expect(errorSpy.mock.calls[0]?.[1]).toBeInstanceOf(Error)
  })
})
