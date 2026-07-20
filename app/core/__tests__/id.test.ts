import { describe, expect, it } from "vitest"
import { generateId } from "../id"

const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/

describe("generateId (ULID)", () => {
  it("matches the 26-char Crockford base32 ULID regex", () => {
    expect(generateId()).toMatch(ULID_RE)
    expect(generateId()).toMatch(ULID_RE)
    expect(generateId(0)).toMatch(ULID_RE)
  })

  it("returns distinct ids back-to-back", () => {
    const a = generateId()
    const b = generateId()
    expect(a).not.toBe(b)
  })

  it("emits the all-zero time prefix for `now = 0`", () => {
    expect(generateId(0).slice(0, 10)).toBe("0000000000")
  })

  it("emits the same time prefix for the same timestamp", () => {
    const now = 1_680_000_000_000
    expect(generateId(now).slice(0, 10)).toBe(generateId(now).slice(0, 10))
  })

  it("sorts lexicographically when timestamps are monotonic", () => {
    const a = generateId(1_000_000)
    const b = generateId(1_000_001)
    expect(a < b).toBe(true)
  })

  it("returns distinct random suffixes for the same timestamp", () => {
    const now = 1_680_000_000_000
    expect(generateId(now)).not.toBe(generateId(now))
  })

  it("clamps non-finite / negative timestamps to the zero time prefix", () => {
    expect(generateId(Number.NaN).slice(0, 10)).toBe("0000000000")
    expect(generateId(-1).slice(0, 10)).toBe("0000000000")
  })
})
