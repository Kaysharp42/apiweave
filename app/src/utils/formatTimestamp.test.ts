import { describe, expect, it } from "vitest";
import { formatTimestamp } from "./formatTimestamp";

describe("formatTimestamp", () => {
  it("formats an ISO timestamp without milliseconds", () => {
    // Local noon, so the formatter's local-date rendering is 2026 in every
    // timezone. A UTC-midnight fixture renders 2025 west of Greenwich.
    const formatted = formatTimestamp(new Date(2026, 0, 1, 12).toISOString());
    expect(formatted).not.toContain("T");
    expect(formatted).not.toContain(".000Z");
    expect(formatted).toMatch(/2026/);
  });

  it("returns the raw string when it cannot be parsed", () => {
    expect(formatTimestamp("not-a-date")).toBe("not-a-date");
  });
});
