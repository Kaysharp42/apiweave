import { beforeEach, describe, expect, it } from "vitest"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowRepository,
} from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver } from "../scope_resolver"
import { ImportService } from "../import_service"
import { SafeHttp } from "../../runner/safe_http"
import type { HttpRequestNode } from "../import_parsers"

// A springdoc gateway: the pasted URL is a plain swagger-ui page whose only clue
// is swagger-initializer.js, the real definition list lives in swagger-config,
// and every service has its own spec. Nothing in the chain is optional.
const SITE: Record<string, { body: string; contentType: string }> = {
  "https://gw.test/webjars/swagger-ui/index.html": {
    contentType: "text/html",
    body: `<!DOCTYPE html><html><body>
      <script src="./swagger-ui-bundle.js"></script>
      <script src="./swagger-initializer.js"></script>
    </body></html>`,
  },
  "https://gw.test/webjars/swagger-ui/swagger-initializer.js": {
    contentType: "application/javascript",
    body: `window.ui = SwaggerUIBundle({
      url: "https://petstore.swagger.io/v2/swagger.json",
      "configUrl" : "/v3/api-docs/swagger-config"
    });`,
  },
  "https://gw.test/v3/api-docs/swagger-config": {
    contentType: "application/json",
    body: JSON.stringify({
      configUrl: "/v3/api-docs/swagger-config",
      urls: [
        { url: "/swagger/actors/v3/api-docs", name: "Actor Service" },
        { url: "/swagger/auth/v3/api-docs", name: "Auth Service" },
        { url: "/swagger/broken/v3/api-docs", name: "Broken Service" },
      ],
    }),
  },
  "https://gw.test/swagger/actors/v3/api-docs": {
    contentType: "application/json",
    body: JSON.stringify({
      openapi: "3.0.1",
      info: { title: "Actor Service API", version: "1.0" },
      servers: [{ url: "https://gw.test" }],
      paths: { "/api/v1/actors": { get: { operationId: "listActors" } } },
    }),
  },
  "https://gw.test/swagger/auth/v3/api-docs": {
    contentType: "application/json",
    body: JSON.stringify({
      openapi: "3.0.1",
      info: { title: "Auth Service API", version: "1.0" },
      servers: [{ url: "https://gw.test" }],
      paths: { "/api/v1/login": { post: { operationId: "login" } } },
    }),
  },
  // A page with no Swagger config anywhere.
  "https://bare.test/plain.html": { contentType: "text/html", body: "<html><body>nothing here</body></html>" },
  "https://gw.test/openapi.json": {
    contentType: "application/json",
    body: JSON.stringify({
      openapi: "3.0.1",
      info: { title: "Single API", version: "2.0" },
      paths: { "/ping": { get: { operationId: "ping" } } },
    }),
  },
  // A YAML spec served without a helpful content-type.
  "https://gw.test/spec": {
    contentType: "text/plain",
    body: "openapi: 3.0.1\ninfo:\n  title: Yaml API\n  version: '1.0'\npaths:\n  /yaml:\n    get:\n      operationId: yamlOp\n",
  },
}

let service: ImportService
const requested: string[] = []

// Remote OpenAPI fetching touches neither the database nor permissions.
const noRepo = {} as WorkflowRepository & EnvironmentRepository & CollectionRepository

beforeEach(() => {
  requested.length = 0
  const safeHttp = new SafeHttp({
    dnsLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    fetchImpl: (async (input: string | URL) => {
      const url = typeof input === "string" ? input : input.toString()
      requested.push(url)
      const hit = SITE[url.split("?")[0]!]
      if (!hit) return new Response("not found", { status: 404 })
      return new Response(hit.body, { status: 200, headers: { "content-type": hit.contentType } })
    }) as unknown as typeof fetch,
  })
  service = new ImportService(
    noRepo,
    noRepo,
    noRepo,
    new LocalOnlySyncProvider(),
    new LocalOwnerProvider(),
    new ScopeResolver({ workspaceExists: () => true, environmentExists: () => true }),
    safeHttp,
  )
})

function httpNodes(nodes: readonly { type: string }[]): HttpRequestNode[] {
  return nodes.filter((n): n is HttpRequestNode => n.type === "http-request")
}

describe("remote OpenAPI URL discovery", () => {
  it("imports a direct spec URL", async () => {
    const wf = await service.fetchRemoteOpenApi({ url: "https://gw.test/openapi.json" })
    expect(httpNodes(wf.nodes).map((n) => n.config.url)).toEqual(["/ping"])
  })

  it("imports a YAML spec served as text/plain", async () => {
    const wf = await service.fetchRemoteOpenApi({ url: "https://gw.test/spec" })
    expect(httpNodes(wf.nodes)).toHaveLength(1)
  })

  it("walks swagger-ui page → initializer → swagger-config and merges every definition", async () => {
    const wf = await service.fetchRemoteOpenApi({ url: "https://gw.test/webjars/swagger-ui/index.html" })
    const nodes = httpNodes(wf.nodes)
    expect(nodes.map((n) => n.config.url)).toEqual([
      "https://gw.test/api/v1/actors",
      "https://gw.test/api/v1/login",
    ])
    expect(nodes[0]!.label).toBe("[Actor Service] [GET] listActors")
    expect(nodes[0]!.config.openapiMeta).toMatchObject({
      definitionName: "Actor Service",
      definitionScope: "actor-service",
      path: "/api/v1/actors",
      method: "GET",
    })
    // the stock initializer's petstore placeholder must never win over swagger-config
    expect(requested).not.toContain("https://petstore.swagger.io/v2/swagger.json")
  })

  it("reports definitions it could not fetch instead of failing the whole import", async () => {
    const preview = await service.fetchRemoteOpenApiPreview({ url: "https://gw.test/webjars/swagger-ui/index.html" })
    expect(preview.stats.totalEndpoints).toBe(2)
    expect(preview.warnings?.join(" ")).toContain("Broken Service")
  })

  it("honours the urls.primaryName hint Swagger UI puts in its own URL", async () => {
    const wf = await service.fetchRemoteOpenApi({
      url: "https://gw.test/webjars/swagger-ui/index.html?urls.primaryName=Auth%20Service",
    })
    expect(httpNodes(wf.nodes).map((n) => n.config.url)).toEqual(["https://gw.test/api/v1/login"])
  })

  it("resolves a relative servers entry against the host the spec came from", async () => {
    const wf = await service.fetchRemoteOpenApi({ url: "https://gw.test/webjars/swagger-ui/index.html?urls.primaryName=Auth%20Service" })
    expect(httpNodes(wf.nodes)[0]!.config.url).toBe("https://gw.test/api/v1/login")
  })

  it("reports why the URL itself could not be fetched", async () => {
    await expect(service.fetchRemoteOpenApi({ url: "https://gw.test/nothing.html" }))
      .rejects.toThrow(/Failed to fetch https:\/\/gw.test\/nothing.html: HTTP 404/)
  })

  it("says what to do when the page exposes no spec at all", async () => {
    await expect(service.fetchRemoteOpenApi({ url: "https://bare.test/plain.html" }))
      .rejects.toThrow(/No OpenAPI\/Swagger spec found/)
  })
})
