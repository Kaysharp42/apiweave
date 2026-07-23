import { describe, expect, it } from "vitest"
import { sanitizeExportValue, sanitizeVariablesForExport } from "../secret_utils"

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

  it("redacts FileUpload.value (base64/path) but passes through variable-type references", () => {
    const config = {
      fileUploads: [
        { name: "a.pdf", type: "base64", value: "JVBERi0xLjQK...", fieldName: "file", mimeType: "application/pdf", description: "" },
        { name: "b.pdf", type: "path", value: "/Users/kay/secret.pdf", fieldName: "file", mimeType: "application/pdf", description: "" },
        { name: "c.pdf", type: "variable", value: "myFileVar", fieldName: "file", mimeType: "application/pdf", description: "" },
      ],
    }
    const sanitized = sanitizeExportValue(config) as Record<string, Array<Record<string, unknown>>>
    expect(sanitized["fileUploads"]?.[0]?.["value"]).toBe("<SECRET>")
    expect(sanitized["fileUploads"]?.[1]?.["value"]).toBe("<SECRET>")
    expect(sanitized["fileUploads"]?.[2]?.["value"]).toBe("myFileVar")
  })
})

describe("sanitizeVariablesForExport", () => {
  it("redacts secret-shaped keys, matching prior behavior", () => {
    const sanitized = sanitizeVariablesForExport({ API_TOKEN: "raw-value", label: "keep me" })
    expect(sanitized["API_TOKEN"]).toBe("<SECRET>")
    expect(sanitized["label"]).toBe("keep me")
  })

  it("redacts a secret-looking VALUE stored under an innocuous key (JWT, sk_live_)", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    const sanitized = sanitizeVariablesForExport({
      BASE_URL_TOKEN: jwt,
      STRIPE_KEY: "sk_live_abcdef1234567890",
      COUNT: "42",
    })
    expect(sanitized["BASE_URL_TOKEN"]).toBe("<SECRET>")
    expect(sanitized["STRIPE_KEY"]).toBe("<SECRET>")
    expect(sanitized["COUNT"]).toBe("42")
  })

  it("strips credentials/fragment from a tokenized URL value but leaves a plain URL untouched", () => {
    const sanitized = sanitizeVariablesForExport({
      BASE_URL: "https://user:pass@api.example.com/v1#access_token=abc123",
      PLAIN_URL: "https://api.example.com",
    })
    expect(sanitized["BASE_URL"]).toBe("https://api.example.com/v1")
    // No credentials/secrets present — must round-trip byte-for-byte, no reformatting.
    expect(sanitized["PLAIN_URL"]).toBe("https://api.example.com")
  })
})
