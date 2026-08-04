import { describe, it, expect } from "vitest";
import {
  METRIC_PLACEHOLDER,
  formatDuration,
  formatPassRatio,
  formatSize,
  metricText,
} from "./formatNodeMetrics";

describe("formatDuration", () => {
  it("renders milliseconds below one second", () => {
    expect(formatDuration(0)).toBe("0ms");
    expect(formatDuration(831)).toBe("831ms");
    expect(formatDuration(999)).toBe("999ms");
  });

  it("switches to seconds at one second", () => {
    expect(formatDuration(1000)).toBe("1.0s");
    expect(formatDuration(2640)).toBe("2.6s");
  });

  it("rounds sub-millisecond durations rather than showing decimal noise", () => {
    expect(formatDuration(0.4)).toBe("0ms");
    expect(formatDuration(1.6)).toBe("2ms");
  });

  it("returns null for absent or nonsensical input", () => {
    expect(formatDuration(null)).toBeNull();
    expect(formatDuration(undefined)).toBeNull();
    expect(formatDuration(-1)).toBeNull();
    expect(formatDuration(Number.NaN)).toBeNull();
    expect(formatDuration(Number.POSITIVE_INFINITY)).toBeNull();
  });
});

describe("formatSize", () => {
  it("renders bytes below a kilobyte", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(1023)).toBe("1023 B");
  });

  it("renders kilobytes with one decimal", () => {
    expect(formatSize(1024)).toBe("1.0 KB");
    expect(formatSize(4300)).toBe("4.2 KB");
  });

  it("renders megabytes with one decimal", () => {
    expect(formatSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatSize(1.8 * 1024 * 1024)).toBe("1.8 MB");
  });

  it("returns null for absent or nonsensical input", () => {
    expect(formatSize(null)).toBeNull();
    expect(formatSize(undefined)).toBeNull();
    expect(formatSize(-5)).toBeNull();
    expect(formatSize(Number.NaN)).toBeNull();
  });
});

describe("formatPassRatio", () => {
  it("reports a clean pass without a ratio", () => {
    expect(formatPassRatio(2, 2)).toBe("2 passed");
  });

  it("reports a ratio when some assertions did not pass", () => {
    expect(formatPassRatio(1, 3)).toBe("1/3 passed");
  });

  it("falls back to a bare count when the total is unknown", () => {
    expect(formatPassRatio(4, null)).toBe("4 passed");
    expect(formatPassRatio(4, undefined)).toBe("4 passed");
  });

  it("returns null rather than reporting 0 of 0", () => {
    expect(formatPassRatio(0, 0)).toBeNull();
    expect(formatPassRatio(null, 3)).toBeNull();
  });
});

describe("metricText", () => {
  it("renders the value when present", () => {
    expect(metricText({ label: "duration", value: "831ms" })).toBe("831ms");
  });

  it("renders the placeholder for a null value, so the row shape holds", () => {
    expect(metricText({ label: "size", value: null })).toBe(
      METRIC_PLACEHOLDER,
    );
  });

  it("treats a blank value as absent", () => {
    expect(metricText({ label: "size", value: "   " })).toBe(
      METRIC_PLACEHOLDER,
    );
  });

  it("trims surrounding whitespace", () => {
    expect(metricText({ label: "status", value: " 200 OK " })).toBe("200 OK");
  });
});
