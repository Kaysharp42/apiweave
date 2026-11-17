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

  it("generates strictly increasing ids for one millisecond", () => {
    const now = 1_680_000_000_123
    const ids = Array.from({ length: 1000 }, () => generateId(now))
    for (const id of ids) {
      expect(id).toMatch(ULID_RE)
      expect(id.slice(0, 10)).toBe(ids[0]?.slice(0, 10))
    }
    for (let index = 1; index < ids.length; index += 1) {
      expect((ids[index] as string) > (ids[index - 1] as string), `id ${index}`).toBe(true)
    }
  })

  it("sorts a later millisecond after a run of ids from an earlier one", () => {
    const now = 1_680_000_000_123
    const ids = Array.from({ length: 100 }, () => generateId(now))
    const later = generateId(now + 1)
    expect(later).toMatch(ULID_RE)
    expect(later > (ids[ids.length - 1] as string)).toBe(true)
  })

  it("starts a fresh suffix in a different millisecond and stays monotonic within it", () => {
    const before = generateId(1_680_000_000_500)
    const moved = generateId(1_680_000_000_501)
    expect(moved).toMatch(ULID_RE)
    expect(moved.slice(0, 10)).not.toBe(before.slice(0, 10))

    const first = generateId(1_680_000_000_700)
    const second = generateId(1_680_000_000_700)
    expect(second > first).toBe(true)
  })
})
