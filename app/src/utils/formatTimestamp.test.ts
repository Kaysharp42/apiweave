import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./formatTimestamp";

describe("formatTimestamp", () => {
  it("formats an ISO timestamp without milliseconds", () => {
    const formatted = formatTimestamp("2026-01-01T00:00:00.000Z");
    expect(formatted).not.toContain("T");
    expect(formatted).not.toContain(".000Z");
    expect(formatted).toMatch(/2026/);
  });

  it("returns the raw string when it cannot be parsed", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});
