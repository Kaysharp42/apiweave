import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { JsonValue } from "@shared/types/JsonValue"
import { initDatabase, type InitializedDatabase } from "../../db"
import { CollectionRepository, EnvironmentRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { LocalOwnerProvider } from "../../auth/LocalOwnerProvider"
import { LocalOnlySyncProvider } from "../../sync/LocalOnlySyncProvider"
import { ScopeResolver } from "../scope_resolver"
import { ProjectExportService } from "../project_export_service"
import { convertPostmanCollection, convertTestScript, isPostmanCollection, safeName } from "../postman_import"

const FIXTURES = path.join(__dirname, "__fixtures__")
const readFixture = (name: string): Record<string, unknown> =>
  JSON.parse(fs.readFileSync(path.join(FIXTURES, name), "utf8")) as Record<string, unknown>
const collection = readFixture("shop.postman_collection.json")
const environment = readFixture("shop.postman_environment.json")

/** Every credential literal in the fixtures: none may survive a conversion or an import. */
const CREDENTIAL_LITERALS = [
  "hunter2",
  "sk_test_123",
  "s3cr3t-value",
  "pw-not-imported",
  "digest-pass",
  "cached-access-token-value",
  "eyJhbGciOiJIUzI1NiJ9",
  "abc.def-123456",
]

type Node = { readonly type: string; readonly label: string; readonly config: Record<string, JsonValue> }

function convert(mode?: "folder" | "request") {
  return convertPostmanCollection(collection, { workspaceId: "ws-1", environment, mode })
}

function request(label: string): Record<string, JsonValue> {
  for (const workflow of convert().bundle.workflows) {
    const node = (workflow.nodes as unknown as Node[]).find((candidate) => candidate.label === label)
    if (node) return node.config
  }
  throw new Error(`no request ${label}`)
}

describe("Postman collection conversion", () => {
  it("makes one workflow per folder, nested folders flattened, top-level requests first", () => {
    const { preview, bundle } = convert()
    expect(preview.projectName).toBe("Shop API")
    expect(preview.workflows).toEqual([
      { name: "Shop API", requestCount: 1 },
      { name: "Auth", requestCount: 2 },
      { name: "Orders", requestCount: 2 },
      { name: "Orders / Admin", requestCount: 3 },
      { name: "Catalog", requestCount: 5 },
    ])
    const orders = bundle.workflows.find((workflow) => workflow.name === "Orders")!
    expect(orders.description).toBe("Everything about orders.")
    // Start → requests in order → End.
    const nodes = orders.nodes as unknown as (Node & { nodeId: string })[]
    const http = nodes.filter((node) => node.type === "http-request")
    expect(http.map((node) => node.label)).toEqual(["List orders", "Get order"])
    const start = nodes.find((node) => node.type === "start")!
    const end = nodes.find((node) => node.type === "end")!
    expect(orders.edges.map((edge) => {
      const { source, target } = edge as { source: string; target: string }
      return [source, target]
    })).toEqual([[start.nodeId, http[0]!.nodeId], [http[0]!.nodeId, http[1]!.nodeId], [http[1]!.nodeId, end.nodeId]])
  })

  it("makes one workflow per request on request", () => {
    const names = convert("request").preview.workflows.map((workflow) => workflow.name)
    expect(names).toHaveLength(13)
    expect(names).toContain("Orders / Admin / Upload receipt")
    expect(names[0]).toBe("Health")
  })

  it("maps method, URL, query, path variables and headers, skipping disabled rows", () => {
    expect(request("List orders")).toMatchObject({
      method: "GET",
      url: "{{env.baseUrl}}/orders",
      queryParams: [{ key: "page", value: "1" }, { key: "limit", value: "{{env.pageSize}}" }],
      headers: [{ key: "Accept", value: "application/json" }, { key: "X-Request-Id", value: "{{uuid()}}" }],
    })
    expect(request("Get order")).toMatchObject({
      url: "{{env.baseUrl}}/orders/{orderId}",
      pathVariables: [{ key: "orderId", value: "{{env.orderId}}" }],
    })
  })

  it("maps every body mode", () => {
    expect(request("Login")).toMatchObject({ bodyType: "json" })
    expect(request("Export orders")).toMatchObject({
      bodyType: "x-www-form-urlencoded",
      urlEncodedEntries: [{ key: "format", value: "csv", active: true }, { key: "since", value: "{{iso_timestamp()}}", active: true }],
    })
    expect(request("Upload receipt")).toMatchObject({
      bodyType: "form-data",
      formDataEntries: [{ key: "note", value: "monthly", type: "text", active: true }],
    })
    const graphql = request("Search products")
    expect(graphql["bodyType"]).toBe("json")
    expect(JSON.parse((graphql["body"] as string).replace("{{env.searchTerm}}", "shoes"))).toEqual({
      query: "query Search($term: String!) { products(term: $term) { id name } }",
      variables: { term: "shoes" },
    })
    expect(request("Ping")).toMatchObject({ bodyType: "raw", body: "ping", headers: [{ key: "Content-Type", value: "text/plain" }] })
    // An explicit Content-Type wins over the language's.
    expect(request("Import feed")["headers"]).toEqual([{ key: "Content-Type", value: "application/vnd.shop+xml" }])
    expect(request("Delete product")["body"]).toBeUndefined()
  })

  it("resolves auth through collection, folder and request, with every credential a secret reference", () => {
    expect(request("Health")["auth"]).toEqual({ type: "bearer", bearer: { token: "{{secrets.accessToken}}" } })
    expect(request("Login")["auth"]).toBeUndefined()
    // Inherited two levels down from the Orders folder.
    expect(request("Export orders")["auth"]).toEqual({
      type: "apiKey",
      apiKey: { key: "X-API-Key", value: "{{secrets.API_KEY_OF_FOLDER_ORDERS}}", addTo: "header" },
    })
    expect(request("Search products")["auth"]).toEqual({
      type: "oauth2",
      oauth2: {
        grantType: "client_credentials",
        tokenUrl: "{{env.baseUrl}}/oauth/token",
        clientId: "shop-client",
        clientSecret: "{{secrets.OAUTH_2_0_CLIENT_SECRET_OF_FOLDER_CATALOG}}",
        scope: "catalog:read",
        clientAuth: "body",
      },
    })
    expect(request("Delete product")["auth"]).toEqual({ type: "basic", basic: { username: "admin", password: "{{secrets.adminPassword}}" } })
    expect(request("Legacy report")["auth"]).toBeUndefined()
    expect(convert().preview.warnings).toContain(
      'request "Legacy report" uses digest auth, which APIWeave does not support; its requests are imported without auth',
    )
  })

  it("lists every secret to create and never carries a credential value", () => {
    const { preview, bundle } = convert()
    expect(preview.requiredSecrets.map((secret) => secret.name).sort()).toEqual([
      "API_KEY_OF_FOLDER_ORDERS",
      "LOGIN_PASSWORD",
      "OAUTH_2_0_CLIENT_SECRET_OF_FOLDER_CATALOG",
      "accessToken",
      "adminPassword",
    ])
    expect(bundle.secretReferences.map((ref) => ref.name).sort()).toEqual(preview.requiredSecrets.map((secret) => secret.name).sort())
    expect(request("Login")["body"]).toBe('{\n  "username": "{{env.username}}",\n  "password": "{{secrets.LOGIN_PASSWORD}}"\n}')
    const serialized = JSON.stringify(bundle)
    for (const literal of CREDENTIAL_LITERALS) expect(serialized).not.toContain(literal)
  })

  it("puts plain variables in one environment, environment over collection, and script-set ones in workflow variables", () => {
    const { bundle, preview } = convert()
    expect(bundle.environments).toHaveLength(1)
    expect(bundle.environments[0]).toMatchObject({
      name: "Postman: Staging",
      variables: { baseUrl: "https://staging.example.test", pageSize: "20", username: "shopper", searchTerm: "shoes", orderId: "", productId: "" },
    })
    expect(preview.environment).toEqual({ name: "Postman: Staging", variableCount: 6 })
    for (const workflow of bundle.workflows) expect(workflow.selectedEnvironmentId).toBe("postman_environment")

    const auth = bundle.workflows.find((workflow) => workflow.name === "Auth")!
    expect(auth.variables).toEqual({ accessToken: "", userId: "" })
    expect(request("Me")).toMatchObject({
      url: "{{env.baseUrl}}/users/{{variables.userId}}",
      auth: { type: "bearer", bearer: { token: "{{variables.accessToken}}" } },
    })
    expect(preview.warnings).toContain("Variable {{orderId}} has no value in the collection or environment; set it in the imported environment")
  })

  it("names the collection itself as the environment without an environment file", () => {
    const { bundle } = convertPostmanCollection(collection, { workspaceId: "ws-1" })
    expect(bundle.environments[0]).toMatchObject({ name: "Postman: Shop API", variables: { baseUrl: "https://api.example.test" } })
  })

  it("maps dynamic variables with an equivalent and warns about the rest", () => {
    expect(request("Random product")).toMatchObject({
      headers: [{ key: "X-Sent-At", value: "{{timestamp()}}" }],
      queryParams: [{ key: "seed", value: "{{randomNumber(3)}}" }, { key: "name", value: "{{$randomFirstName}}" }],
    })
    expect(convert().preview.warnings).toContain("Dynamic variable {{$randomFirstName}} has no APIWeave equivalent; it is left as is")
  })

  it("turns status checks and response-variable scripts into expectedStatus and extractors", () => {
    expect(request("Health")["expectedStatus"]).toBe(200)
    expect(request("Login")).toMatchObject({
      expectedStatus: 200,
      extractors: { accessToken: "response.body.data.token", userId: "response.body.data.user.id" },
    })
    // A fully converted script leaves no note behind; a partial one is kept with a warning.
    const auth = convert().bundle.workflows.find((workflow) => workflow.name === "Auth")!
    expect((auth.nodes as unknown as Node[]).some((node) => node.type === "note")).toBe(false)
    const orders = convert().bundle.workflows.find((workflow) => workflow.name === "Orders")!
    const note = (orders.nodes as unknown as Node[]).find((node) => node.type === "note")!
    expect(note.config["content"]).toContain("pm.expect(pm.response.json().items.length).to.be.above(0);")
    expect(note.config["content"]).toContain('pm.variables.set("requestedAt", Date.now());')
    expect(convert().preview.warnings).toEqual(expect.arrayContaining([
      '"Orders" › "List orders": test script partly converted; its text is kept in a note on the canvas',
      '"Orders" › "Get order": prerequest script not converted; its text is kept in a note on the canvas',
      '"Orders / Admin" › "Upload receipt": form-data file field "receipt" skipped; add the file on the node',
    ]))
  })

  it("keeps collection and folder scripts in descriptions, withholding one that holds a credential", () => {
    const { bundle, preview } = convert()
    expect(bundle.workflows.find((workflow) => workflow.name === "Catalog")!.description).toContain(
      'Folder "Catalog" prerequest script (not converted):\npm.request.headers.add({ key: "X-Trace", value: "catalog" });',
    )
    expect(bundle.project.description).toContain("Orders, catalog and auth for the demo shop.")
    expect(bundle.project.description).toContain("Withheld: this script holds what looks like a credential.")
    expect(preview.warnings).toContain("Collection-level scripts are not converted; they are kept in the project description")
  })

  it("rejects Collection v1 and v2.0 files with a clear message", () => {
    const v1 = { id: "x", name: "Old", order: [], requests: [] }
    expect(isPostmanCollection(v1)).toBe(true)
    expect(() => convertPostmanCollection(v1, { workspaceId: "ws" })).toThrow(/Postman Collection v1 file.*Collection v2\.1/)
    const v20 = { info: { name: "Mid", schema: "https://schema.getpostman.com/json/collection/v2.0.0/collection.json" }, item: [] }
    expect(() => convertPostmanCollection(v20, { workspaceId: "ws" })).toThrow(/v2\.0 file/)
    const broken = { info: { name: "Bad", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: "nope" }
    expect(() => convertPostmanCollection(broken, { workspaceId: "ws" })).toThrow(/Invalid Postman collection: item/)
    const empty = { info: { name: "Empty", schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" }, item: [] }
    expect(() => convertPostmanCollection(empty, { workspaceId: "ws" })).toThrow(/no requests/)
  })
})

describe("convertTestScript", () => {
  it("recognizes status checks and response JSON paths and nothing else", () => {
    expect(convertTestScript('pm.test("ok", () => {\n  pm.response.to.have.status(201);\n});')).toEqual({
      expectedStatus: [201],
      extractors: new Map(),
      complete: true,
    })
    const extracted = convertTestScript('const body = pm.response.json();\npm.collectionVariables.set("first", body.items[0].id);\npm.environment.set("raw", pm.response.json().token)')
    expect([...extracted.extractors]).toEqual([["first", "response.body.items[0].id"], ["raw", "response.body.token"]])
    expect(extracted.complete).toBe(true)
    // An expression that is not a response JSON path stays a script.
    expect(convertTestScript('pm.environment.set("t", Date.now());')).toMatchObject({ extractors: new Map(), complete: false })
    expect(convertTestScript('pm.expect(pm.response.code).to.equal(404);\nconsole.log("x")')).toMatchObject({ expectedStatus: [404], complete: false })
  })

  it("normalizes names to letters, digits and underscores", () => {
    expect(safeName("base-url")).toBe("base_url")
    expect(safeName("1st")).toBe("_1st")
  })
})

describe("Postman import into the database", () => {
  let db: InitializedDatabase
  let workspaceId: string
  let workflows: WorkflowRepository
  let environments: EnvironmentRepository
  let collections: CollectionRepository
  let projects: ProjectExportService

  beforeEach(() => {
    db = initDatabase({ databasePath: ":memory:" })
    const workspaces = new WorkspaceRepository(db.kvStore)
    workflows = new WorkflowRepository(db.kvStore)
    environments = new EnvironmentRepository(db.kvStore)
    collections = new CollectionRepository(db.kvStore)
    const scopeResolver = new ScopeResolver({
      workspaceExists: (id) => workspaces.getById(id) !== undefined,
      environmentExists: (id) => environments.getById(id) !== undefined,
    })
    projects = new ProjectExportService(collections, workflows, environments, new LocalOnlySyncProvider(), new LocalOwnerProvider(), scopeResolver)
    workspaceId = workspaces.create({ name: "test", slug: "test" }).workspaceId
  })

  afterEach(() => db.close())

  it("creates the project, its workflows and the environment, and stores no credential", async () => {
    const { bundle } = convertPostmanCollection(collection, { workspaceId, environment })
    const result = await projects.importProject(workspaceId, bundle)

    const project = collections.getById(result.projectId)!
    expect(project.name).toBe("Shop API")
    const imported = workflows.listByCollection(workspaceId, result.projectId).items
    expect(imported.map((workflow) => workflow.name).sort()).toEqual(["Auth", "Catalog", "Orders", "Orders / Admin", "Shop API"])
    const [env] = environments.listByWorkspace(workspaceId).items
    expect(env?.name).toBe("Postman: Staging")
    for (const workflow of imported) expect(workflow.selectedEnvironmentId).toBe(env?.environmentId)
    expect(result.missingSecrets).toHaveLength(5)

    const stored = JSON.stringify([imported, environments.listByWorkspace(workspaceId).items, project])
    for (const literal of CREDENTIAL_LITERALS) expect(stored).not.toContain(literal)
  })
})
