import { describe, expect, it } from "vitest";
import { normalizeAuthConfig } from "./httpRequestConfigCompat";

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
