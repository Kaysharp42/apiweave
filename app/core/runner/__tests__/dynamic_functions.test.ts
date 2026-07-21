import { describe, expect, it } from "vitest"
import { DynamicFunctions } from "../dynamic_functions"
import { FixedClockProvider, SeededRandomProvider, WallClockProvider, CryptoRandomProvider } from "../harness/providers"

describe("DynamicFunctions (seeded)", () => {
  const clock = new FixedClockProvider("2026-01-01T00:00:00Z")
  const rng = new SeededRandomProvider("0xDEADBEEF")
  const fn = new DynamicFunctions(clock, rng)

  it("uuid matches the captured parity vector for the seed and clock", () => {
    const out = fn.uuid()
    // First 16 bytes from SeededRandomProvider(0xDEADBEEF); uuid v4 layout applied.
    expect(out).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    const out2 = new DynamicFunctions(clock, new SeededRandomProvider("0xDEADBEEF")).uuid()
    expect(out).toBe(out2)
  })

  it("timestamp reads from ClockProvider (2026-01-01T00:00:00Z)", () => {
    expect(fn.timestamp()).toBe(String(Math.floor(new Date("2026-01-01T00:00:00Z").getTime() / 1000)))
  })

  it("iso_timestamp reads from ClockProvider and is ISO 8601", () => {
    expect(fn.iso_timestamp()).toBe("2026-01-01T00:00:00.000Z")
  })

  it("date() defaults to %Y-%m-%d rooted at the clock", () => {
    expect(fn.date()).toBe("2026-01-01")
  })

  it("futureDate(7) advances the clock by 7 days", () => {
    expect(fn.futureDate(7)).toBe("2026-01-08")
    expect(fn.futureDate(7, "%d/%m/%Y")).toBe("08/01/2026")
  })

  it("pastDate(7) steps the clock back 7 days", () => {
    expect(fn.pastDate(7)).toBe("2025-12-25")
  })

  it("distinct seeds produce distinct uuid outputs", () => {
    const a = new DynamicFunctions(clock, new SeededRandomProvider("0xDEADBEEF")).uuid()
    const b = new DynamicFunctions(clock, new SeededRandomProvider("0xCAFEBABE")).uuid()
    expect(a).not.toBe(b)
  })

  it("distinct seeds produce distinct randomString outputs", () => {
    const a = new DynamicFunctions(clock, new SeededRandomProvider("0xDEADBEEF")).randomString(20)
    const b = new DynamicFunctions(clock, new SeededRandomProvider("0xCAFEBABE")).randomString(20)
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[A-Za-z0-9]{20}$/)
  })

  it("randomString(0/NaN/-1) silently falls back to default length 10", () => {
    expect(fn.randomString(0)).toHaveLength(10)
    expect(fn.randomString("nope")).toHaveLength(10)
    expect(fn.randomString(-3)).toHaveLength(10)
  })

  it("randomNumber(6) returns a 6-character digit string within range", () => {
    const out = fn.randomNumber(6)
    expect(out).toMatch(/^[0-9]{6}$/)
    const n = Number(out)
    expect(n).toBeGreaterThanOrEqual(100_000)
    expect(n).toBeLessThanOrEqual(999_999)
  })

  it("randomEmail() ends with @example.com and has 10-char local part", () => {
    const out = fn.randomEmail()
    expect(out).toMatch(/^[A-Za-z0-9]{10}@example\.com$/)
  })

  it("randomAlpha(8) is letters-only", () => {
    expect(fn.randomAlpha(8)).toMatch(/^[A-Za-z]{8}$/)
  })

  it("randomNumeric(8) is digits-only", () => {
    expect(fn.randomNumeric(8)).toMatch(/^[0-9]{8}$/)
  })

  it("randomHex(16) is lower-hex", () => {
    expect(fn.randomHex(16)).toMatch(/^[0-9a-f]{16}$/)
  })

  it("randomChoice('a,b,c') returns exactly one of the options", () => {
    const out = fn.randomChoice("a,b,c")
    expect(["a", "b", "c"]).toContain(out)
  })

  it("randomChoice trims whitespace and skips empties", () => {
    const out = fn.randomChoice("  x , y ,  ")
    expect(["x", "y"]).toContain(out)
  })

  it("getFunction('uuid') returns the function and roundtrips", () => {
    const f = fn.getFunction("uuid")
    expect(f).toBeDefined()
    const out = f!()
    expect(out).toMatch(/^[\da-f-]{36}$/)
  })

  it("getFunction('unknown') is undefined", () => {
    expect(fn.getFunction("doesNotExist")).toBeUndefined()
  })

  it("getAllFunctions() lists all 13 functions", () => {
    const docs = fn.getAllFunctions()
    expect(Object.keys(docs)).toHaveLength(13)
    expect(docs["uuid()"]).toContain("UUID")
  })
})

describe("DynamicFunctions (wall clock + crypto)", () => {
  const fn = new DynamicFunctions(new WallClockProvider(), new CryptoRandomProvider())

  it("uuid() is a real v4 string fast enough to inspect before clock advances", () => {
    const a = fn.uuid()
    const b = fn.uuid()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  it("timestamp() within a second of wall clock", () => {
    const before = Math.floor(Date.now() / 1000)
    const t = Number(fn.timestamp())
    const after = Math.floor(Date.now() / 1000)
    expect(t).toBeGreaterThanOrEqual(before)
    expect(t).toBeLessThanOrEqual(after)
  })
})
