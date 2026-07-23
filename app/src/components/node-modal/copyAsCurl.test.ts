import { describe, expect, it } from "vitest";
import { buildCurlCommand, buildFetchCommand } from "./copyAsCurl";
import type { NodeModalHTTPRequestConfig } from "../../types";

function baseConfig(overrides: Partial<NodeModalHTTPRequestConfig> = {}): NodeModalHTTPRequestConfig {
  return {
    method: "GET",
    url: "https://api.example.com/x",
    headers: [],
    queryParams: [],
    body: "",
    bodyType: "none",
    auth: { type: "none" },
    ...overrides,
  } as NodeModalHTTPRequestConfig;
}

describe("copyAsCurl — Basic auth header", () => {
  it("base64-encodes username:password (RFC 7617), not the raw pair", () => {
    const config = baseConfig({
      auth: { type: "basic", basic: { username: "alice", password: "hunter2" } },
    });

    const curl = buildCurlCommand(config);
    expect(curl).toContain(`Authorization: Basic ${btoa("alice:hunter2")}`);
    expect(curl).not.toContain("alice:hunter2");

    const fetchCmd = buildFetchCommand(config);
    expect(fetchCmd).toContain(btoa("alice:hunter2"));
    expect(fetchCmd).not.toContain("alice:hunter2");
  });
});
