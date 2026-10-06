import { describe, expect, it } from "vitest"
import { startupFailureMessage } from "../startup_failure"

const paths = { logFile: "/logs/apiweave-main-2026-10-06.log", userData: "/data/APIWeave" }

describe("startupFailureMessage", () => {
  it("names the error, the log file and the data folder", () => {
    const message = startupFailureMessage(new Error("database schema 9 is newer than this build"), paths)

    expect(message).toContain("database schema 9 is newer than this build")
    expect(message).toContain(paths.logFile)
    expect(message).toContain(paths.userData)
  })

  it("renders a non-Error throw", () => {
    expect(startupFailureMessage("keyfile unreadable", paths)).toMatch(/^keyfile unreadable\n/)
  })
})
