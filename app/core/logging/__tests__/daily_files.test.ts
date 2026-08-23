import { describe, expect, it } from "vitest"
import { isExpiredLogFile, logFileName, logFileStamp, parseLogFileName } from "../daily_files"

describe("logFileStamp", () => {
  it("formats in local time, zero-padded", () => {
    // 2026-08-23 local midnight + a few hours — no UTC shifting.
    expect(logFileStamp(new Date(2026, 7, 23, 5, 7, 9))).toBe("2026-08-23")
    expect(logFileStamp(new Date(2026, 0, 2))).toBe("2026-01-02")
  })
})

describe("logFileName", () => {
  it("names the live file for the day", () => {
    expect(logFileName(new Date(2026, 7, 23))).toBe("apiweave-main-2026-08-23.log")
  })
})

describe("parseLogFileName", () => {
  it("reads back the day from a live file", () => {
    expect(parseLogFileName("apiweave-main-2026-08-23.log")).toEqual(new Date(2026, 7, 23))
  })

  it("accepts a size-rotated chunk of the same day", () => {
    expect(parseLogFileName("apiweave-main-2026-08-23.143005.log")).toEqual(new Date(2026, 7, 23))
  })

  it("rejects anything that is not one of ours", () => {
    // The legacy single-file layout from earlier releases must never be
    // deleted by the daily retention sweep.
    expect(parseLogFileName("main.log")).toBeNull()
    expect(parseLogFileName("main.old.log")).toBeNull()
    expect(parseLogFileName("apiweave-main-not-a-date.log")).toBeNull()
    expect(parseLogFileName("apiweave-main-2026-13-99.txt")).toBeNull()
    expect(parseLogFileName("unrelated.log")).toBeNull()
  })

  it("rejects an impossible calendar date rather than rolling it over", () => {
    // new Date(2026, 1, 31) would happily become March 3rd; the parser must
    // not let that pass as February 31st.
    expect(parseLogFileName("apiweave-main-2026-02-31.log")).toBeNull()
    expect(parseLogFileName("apiweave-main-2026-02-30.log")).toBeNull()
  })
})

describe("isExpiredLogFile", () => {
  const now = new Date(2026, 7, 23)

  it("keeps today and every day within the retention window", () => {
    expect(isExpiredLogFile("apiweave-main-2026-08-23.log", now, 14)).toBe(false)
    expect(isExpiredLogFile("apiweave-main-2026-08-10.log", now, 14)).toBe(false)
  })

  it("expires the first day past the window", () => {
    // 13 full days back is the oldest survivor; 14 is out.
    expect(isExpiredLogFile("apiweave-main-2026-08-09.log", now, 14)).toBe(true)
  })

  it("expires old rotated chunks too", () => {
    expect(isExpiredLogFile("apiweave-main-2026-06-01.091500.log", now, 14)).toBe(true)
  })

  it("never expires files it does not own", () => {
    expect(isExpiredLogFile("main.old.log", now, 14)).toBe(false)
    expect(isExpiredLogFile("unrelated.log", now, 1)).toBe(false)
  })

  it("measures whole days, so hours of the clock cannot expire a file early", () => {
    const noon = new Date(2026, 7, 23, 12)
    // Yesterday at retentionDays=1: still inside until today ends? No —
    // yesterday's file covers a whole past day, so at retention 1 it is out;
    // today's never is, whatever time it is.
    expect(isExpiredLogFile("apiweave-main-2026-08-22.log", noon, 1)).toBe(true)
    expect(isExpiredLogFile("apiweave-main-2026-08-23.log", noon, 1)).toBe(false)
  })
})
