import { describe, expect, it } from "vitest";
import { normalizeAuthConfig, normalizeExpectedStatus } from "./httpRequestConfigCompat";

describe("normalizeAuthConfig", () => {
  it("drops stale sub-configs from other auth types", () => {
    const result = normalizeAuthConfig({
      type: "none",
      bearer: { token: "old-token" },
      basic: { username: "u", password: "old-pass" },
      apiKey: { key: "X-Api-Key", value: "old-secret", addTo: "header" },
    });
    expect(result).toEqual({ type: "none" });
  });

  it("keeps only the selected type's sub-config", () => {
    const result = normalizeAuthConfig({
      type: "bearer",
      bearer: { token: "keep-me" },
      apiKey: { key: "X-Api-Key", value: "stale-secret", addTo: "header" },
    });
    expect(result).toEqual({ type: "bearer", bearer: { token: "keep-me" } });
  });

  it("preserves apiKey config when selected", () => {
    const result = normalizeAuthConfig({
      type: "apiKey",
      apiKey: { key: "X-Api-Key", value: "current-secret", addTo: "query" },
    });
    expect(result).toEqual({
      type: "apiKey",
      apiKey: { key: "X-Api-Key", value: "current-secret", addTo: "query" },
    });
  });
});

describe("normalizeExpectedStatus", () => {
  it("keeps a single in-range status code", () => {
    expect(normalizeExpectedStatus(409)).toBe(409);
  });

  it("keeps an array of in-range status codes", () => {
    expect(normalizeExpectedStatus([409, 422])).toEqual([409, 422]);
  });

  it("drops out-of-range or non-integer entries from an array instead of discarding the whole field", () => {
    expect(normalizeExpectedStatus([409, 42, 200.5, 900])).toEqual([409]);
  });

  it("returns undefined for an out-of-range single value, an empty array, or a non-numeric value", () => {
    expect(normalizeExpectedStatus(42)).toBeUndefined();
    expect(normalizeExpectedStatus([])).toBeUndefined();
    expect(normalizeExpectedStatus("409")).toBeUndefined();
    expect(normalizeExpectedStatus(undefined)).toBeUndefined();
  });
});
