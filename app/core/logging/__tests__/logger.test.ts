import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { LogLevel } from "@shared/types/Logger"
import { bindLogBackend, getLogger } from "../logger"
import type { LogBackend } from "../logger"

/** A backend that records everything written to it. */
function recordingBackend(): LogBackend & {
  records: Array<{ level: LogLevel; name: string; message: string; data: readonly unknown[] }>
} {
  const records: Array<{ level: LogLevel; name: string; message: string; data: readonly unknown[] }> = []
  return {
    records,
    write: (level, name, message, data) => {
      records.push({ level, name, message, data })
    },
  }
}

// One backend per file: the module keeps its binding across tests, and
// re-binding to a *different* backend is exactly the wiring bug bindLogBackend
// exists to refuse.
const backend = recordingBackend()

describe("getLogger", () => {
  beforeEach(() => {
    backend.records.length = 0
    bindLogBackend(backend)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("routes a record with the logger's name, level and payload", () => {
    getLogger("cloud-sync").warn("pull failed", new Error("offline"))

    expect(backend.records).toEqual([
      { level: "warn", name: "cloud-sync", message: "pull failed", data: [expect.any(Error)] },
    ])
  })

  it("returns the same instance for the same name", () => {
    expect(getLogger("ipc")).toBe(getLogger("ipc"))
    // Different names must not share an instance — the name is the tag.
    expect(getLogger("ipc")).not.toBe(getLogger("updater"))
  })

  it("exposes exactly the four levels of the contract", () => {
    const log = getLogger("levels")

    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")

    expect(backend.records.map((r) => r.level)).toEqual(["debug", "info", "warn", "error"])
  })

  it("keeps writing after a re-bind to the same backend", () => {
    bindLogBackend(backend)

    getLogger("stable").info("still works")

    expect(backend.records).toHaveLength(1)
  })
})

describe("console fallback", () => {
  // A pristine module instance: no bindLogBackend call has ever touched it,
  // so every record must land on the console.
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("writes timestamped lines to the console before any backend is bound", async () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
    const fresh = await import("../logger")

    fresh.getLogger("bootstrap").error("boom", 42)

    expect(errorSpy).toHaveBeenCalledOnce()
    const line = String(errorSpy.mock.calls[0]?.[0])
    expect(line).toMatch(/^\[\d{2}:\d{2}:\d{2}\.\d{3}\] \[ERROR\] \[bootstrap\] boom$/)
    expect(errorSpy.mock.calls[0]?.slice(1)).toEqual([42])
  })

  it("refuses a second binding that would silently re-route records", async () => {
    const first = recordingBackend()
    const second = recordingBackend()
    const fresh = await import("../logger")

    fresh.bindLogBackend(first)
    expect(() => fresh.bindLogBackend(second)).toThrow()

    // The refused binding changed nothing.
    fresh.getLogger("x").info("hello")
    expect(first.records).toHaveLength(1)
    expect(second.records).toHaveLength(0)
  })
})
