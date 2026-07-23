import { describe, expect, it } from "vitest"
import { sanitizeExportValue } from "../secret_utils"

describe("sanitizeExportValue", () => {
  it("redacts auth sub-config leaves by structural path, not key-name heuristic", () => {
    const config = {
      method: "GET",
      url: "https://example.test/x",
      auth: {
        type: "apiKey",
        apiKey: { key: "X-API-Key", value: "raw-secret-not-keyword-shaped", addTo: "header" },
        bearer: { token: "raw-bearer-token" },
        basic: { username: "alice", password: "hunter2" },
      },
    }

    const sanitized = sanitizeExportValue(config) as Record<string, unknown>
    const auth = sanitized["auth"] as Record<string, unknown>
    expect((auth["apiKey"] as Record<string, unknown>)["value"]).toBe("<SECRET>")
    expect((auth["apiKey"] as Record<string, unknown>)["key"]).toBe("X-API-Key")
    expect((auth["bearer"] as Record<string, unknown>)["token"]).toBe("<SECRET>")
    expect((auth["basic"] as Record<string, unknown>)["password"]).toBe("<SECRET>")
    expect((auth["basic"] as Record<string, unknown>)["username"]).toBe("alice")
  })

  it("redacts KeyValuePair arrays (headers/cookies/queryParams) by value, keeping key names", () => {
    const config = {
      headers: [{ key: "Authorization", value: "Bearer secret" }, { key: "Accept", value: "application/json" }],
      cookies: [{ key: "theme", value: "opaque-session-value" }],
      queryParams: [{ key: "filter", value: "active" }],
    }
    const sanitized = sanitizeExportValue(config) as Record<string, unknown[]>
    expect(sanitized["headers"]).toEqual([{ key: "Accept", value: "application/json" }])
    expect(sanitized["cookies"]).toEqual([{ key: "theme", value: "<SECRET>" }])
    expect(sanitized["queryParams"]).toEqual([{ key: "filter", value: "active" }])
  })

  it("redacts a non-empty body and strips URL userinfo/fragment", () => {
    const config = {
      body: "{\"password\":\"secret\"}",
      url: "https://user:pass@example.test/a/b#access_token=abc123",
    }
    const sanitized = sanitizeExportValue(config) as Record<string, unknown>
    expect(sanitized["body"]).toBe("<SECRET>")
    expect(sanitized["url"]).toBe("https://example.test/a/b")
  })

  it("recurses into arrays, e.g. nodeTemplates wrapping a config object", () => {
    const templates = [{ name: "Reusable", config: { auth: { bearer: { token: "t" } } } }]
    const sanitized = sanitizeExportValue(templates) as Array<Record<string, unknown>>
    const config = sanitized[0]?.["config"] as Record<string, unknown>
    const bearer = (config["auth"] as Record<string, unknown>)["bearer"] as Record<string, unknown>
    expect(bearer["token"]).toBe("<SECRET>")
  })
})
