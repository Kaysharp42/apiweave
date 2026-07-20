import { describe, expect, it, beforeEach } from "vitest"
import {
  parseCurlCommands,
  parseHarData,
  parseOpenApiSpec,
  parseSpecText,
  openApiPreview,
  harDryRun,
  extractSwaggerSpecUrls,
  resetIdCounter,
} from "../import_parsers"

beforeEach(() => {
  resetIdCounter()
})

describe("parseCurlCommands", () => {
  it("parses a simple GET curl with start/end nodes and sequential edges", () => {
    const result = parseCurlCommands('curl -X GET "https://api.example.com/users"')
    expect(result.nodes.length).toBe(3)
    expect(result.nodes[0]!.type).toBe("start")
    expect(result.nodes[1]!.type).toBe("http-request")
    expect(result.nodes[2]!.type).toBe("end")
    expect(result.edges.length).toBe(2)
    expect(result.edges[0]!.source).toBe(result.nodes[0]!.nodeId)
    expect(result.edges[0]!.target).toBe(result.nodes[1]!.nodeId)
    expect(result.edges[1]!.source).toBe(result.nodes[1]!.nodeId)
    expect(result.edges[1]!.target).toBe(result.nodes[2]!.nodeId)
    const http = result.nodes[1]!
    expect(http.type).toBe("http-request")
    if (http.type === "http-request") {
      expect(http.config.method).toBe("GET")
      expect(http.config.url).toBe("https://api.example.com/users")
      expect(http.config.body).toBeUndefined()
    }
  })

  it("splits on && separators", () => {
    const input = 'curl "https://a.com" && curl "https://b.com"'
    const result = parseCurlCommands(input)
    const httpNodes = result.nodes.filter((n) => n.type === "http-request")
    expect(httpNodes.length).toBe(2)
  })

  it("sanitizes bearer tokens when sanitize=true", () => {
    const cmd = `curl -H "Authorization: Bearer secret-token-123" "https://api.example.com"`
    const result = parseCurlCommands(cmd, { sanitize: true })
    const http = result.nodes.find((n) => n.type === "http-request")
    expect(http).toBeDefined()
    if (http && http.type === "http-request") {
      expect(http.config.headers).toContainEqual({ key: "Authorization", value: "[FILTERED]" })
    }
  })

  it("preserves secrets when sanitize=false", () => {
    const cmd = `curl -H "Authorization: Bearer secret-token-123" "https://api.example.com"`
    const result = parseCurlCommands(cmd, { sanitize: false })
    const http = result.nodes.find((n) => n.type === "http-request")
    expect(http).toBeDefined()
    if (http && http.type === "http-request") {
      expect(http.config.headers).toContainEqual({ key: "Authorization", value: "Bearer secret-token-123" })
    }
  })

  it("throws on empty input", () => {
    expect(() => parseCurlCommands("")).toThrow("No valid curl commands found")
  })
})

describe("parseHarData", () => {
  const makeHar = (entries: Record<string, unknown>[]) => ({
    log: { entries },
  })

  it("parses a HAR with one entry and produces start/end chain", () => {
    const har = makeHar([
      {
        request: {
          method: "GET",
          url: "https://api.example.com/users",
          headers: [{ name: "Accept", value: "application/json" }],
          cookies: [],
          queryString: [],
        },
        response: { status: 200, statusText: "OK", headers: [], bodySize: 100 },
        time: 42,
      },
    ])
    const result = parseHarData(har)
    expect(result.nodes.length).toBe(3)
    expect(result.nodes[0]!.type).toBe("start")
    expect(result.nodes[2]!.type).toBe("end")
    expect(result.edges.length).toBe(2)
  })

  it("throws on empty entries", () => {
    expect(() => parseHarData(makeHar([]))).toThrow("HAR file contains no entries")
  })
})

describe("harDryRun", () => {
  it("produces sanitized preview data", () => {
    const har = {
      log: {
        entries: [
          {
            request: {
              method: "GET",
              url: "https://a.com",
              headers: [{ name: "Authorization", value: "Bearer secret" }],
            },
            time: 10,
          },
        ],
      },
    }
    const result = harDryRun(har, { sanitize: true })
    expect(result.stats.totalEntries).toBe(1)
    expect(result.preview).toHaveLength(1)
    expect(result.preview[0]!.headers).toContain("[FILTERED]")
  })
})

describe("parseOpenApiSpec", () => {
  const minimalSpec = {
    openapi: "3.0.0",
    info: { title: "Test API", version: "1.0.0" },
    paths: {
      "/users": {
        get: {
          operationId: "listUsers",
          summary: "List users",
          tags: ["users"],
        },
      },
    },
  }

  it("parses all endpoints with start/end chain", () => {
    const result = parseOpenApiSpec(minimalSpec)
    expect(result.nodes.length).toBe(3)
    expect(result.nodes[0]!.type).toBe("start")
    expect(result.nodes[2]!.type).toBe("end")
    expect(result.edges.length).toBe(2)
  })

  it("throws on empty paths", () => {
    expect(() => parseOpenApiSpec({ openapi: "3.0.0", info: { title: "x", version: "1" }, paths: {} })).toThrow(
      "OpenAPI spec contains no paths",
    )
  })

  it("handles Swagger 2.0 host/basePath", () => {
    const swagger2 = {
      swagger: "2.0",
      info: { title: "Test", version: "1.0" },
      host: "api.test.com",
      basePath: "/v1",
      schemes: ["https"],
      paths: {
        "/items": {
          get: { operationId: "listItems" },
        },
      },
    }
    const result = parseOpenApiSpec(swagger2)
    const http = result.nodes.find((n) => n.type === "http-request")
    expect(http).toBeDefined()
    if (http && http.type === "http-request") {
      expect(http.config.url).toBe("https://api.test.com/v1/items")
    }
  })
})

describe("openApiPreview", () => {
  it("returns servers, tags, and stats", () => {
    const spec = {
      openapi: "3.0.0",
      info: { title: "Test", version: "2.0" },
      servers: [{ url: "https://api.test.com", description: "Production" }],
      paths: {
        "/a": { get: { tags: ["x"] } },
        "/b": { post: { tags: ["y"] } },
      },
    }
    const result = openApiPreview(spec)
    expect(result.stats.apiTitle).toBe("Test")
    expect(result.stats.totalEndpoints).toBe(2)
    expect(result.availableServers).toHaveLength(1)
    expect(result.availableTags.map((t) => t.name).sort()).toEqual(["x", "y"])
  })
})

describe("parseSpecText", () => {
  it("parses JSON", () => {
    const result = parseSpecText('{"openapi":"3.0.0","info":{"title":"t","version":"1"},"paths":{}}')
    expect(result).toHaveProperty("openapi", "3.0.0")
  })

  it("parses YAML", () => {
    const yaml = `
openapi: "3.0.0"
info:
  title: Test
  version: "1.0"
paths: {}
`
    const result = parseSpecText(yaml)
    expect(result).toHaveProperty("openapi", "3.0.0")
  })
})

describe("extractSwaggerSpecUrls", () => {
  it("extracts url from SwaggerUIBundle config", () => {
    const html = `<script>SwaggerUIBundle({ url: "https://petstore.swagger.io/v2/swagger.json" })</script>`
    const urls = extractSwaggerSpecUrls(html, "https://petstore.swagger.io")
    expect(urls).toContain("https://petstore.swagger.io/v2/swagger.json")
  })

  it("extracts configUrl", () => {
    const html = `<script>SwaggerUIBundle({ configUrl: "https://example.com/swagger-config.json" })</script>`
    const urls = extractSwaggerSpecUrls(html, "https://example.com")
    expect(urls).toContain("https://example.com/swagger-config.json")
  })

  it("extracts urls array", () => {
    const html = `<script>SwaggerUIBundle({ urls: [{ url: "https://a.com/spec.json" }, { url: "https://b.com/spec.json" }] })</script>`
    const urls = extractSwaggerSpecUrls(html, "https://example.com")
    expect(urls).toContain("https://a.com/spec.json")
    expect(urls).toContain("https://b.com/spec.json")
  })

  it("extracts href links to spec files", () => {
    const html = `<a href="/openapi.json">API</a>`
    const urls = extractSwaggerSpecUrls(html, "https://example.com")
    expect(urls).toContain("https://example.com/openapi.json")
  })
})
