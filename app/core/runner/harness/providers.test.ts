import { describe, expect, it } from "vitest";
import { FixedClockProvider, SeededRandomProvider } from "./providers";

describe("harness providers", () => {
  it("FixedClockProvider returns the same instant when called repeatedly", () => {
    const clock = new FixedClockProvider("2026-01-02T03:04:05.000Z");

    expect(clock.isoNow()).toBe("2026-01-02T03:04:05.000Z");
    expect(clock.now().toISOString()).toBe("2026-01-02T03:04:05.000Z");
  });

  it("SeededRandomProvider produces identical values for the same seed", () => {
    const left = new SeededRandomProvider("0xDEADBEEF");
    const right = new SeededRandomProvider("0xDEADBEEF");

    expect([left.next(), left.next(), [...left.bytes(4)]]).toEqual([right.next(), right.next(), [...right.bytes(4)]]);
  });

  it("SeededRandomProvider produces different values for different seeds", () => {
    const left = new SeededRandomProvider("0xDEADBEEF");
    const right = new SeededRandomProvider("0xFEEDFACE");

    expect(left.next()).not.toBe(right.next());
  });
});
