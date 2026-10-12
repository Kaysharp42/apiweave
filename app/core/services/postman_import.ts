import { z } from "zod"
import type { JsonValue } from "@shared/types/JsonValue"
import type { PostmanImportPreview } from "@shared/types/PostmanImportPreview"
import type { PostmanRequiredSecret } from "@shared/types/PostmanRequiredSecret"
import { ValidationError } from "../ipc/errors"
import { chainEdges, makeEndNode, makeStartNode, positionForIndex } from "./import_parsers"
import { SCHEMA_VERSION, type ExportedEnvironment, type ExportedWorkflow, type ProjectBundle } from "./project_export_service"
import { containsCredentialMaterial, isSecretKey } from "@shared/credentials/credentials"
import { safeName } from "@shared/env-file/envFile"

/**
 * Postman Collection v2.1 → APIWeave project bundle. Pure: it builds the same
 * `.awecollection` bundle an export produces, and `ProjectExportService`
 * imports it, so a Postman import gets the bundle import's validation, single
 * transaction and missing-secret check for free. Every mapping rule is
 * documented in docs/guides/migrating-from-postman.md; keep the two in step.
 *
 * Credentials never reach the bundle: a literal in a credential slot becomes a
 * `{{secrets.NAME}}` reference, a variable a credential slot reads becomes a
 * secret too, and the names are returned for the user to create.
 */

/** One workflow per folder (the default), or one per request. */
export type PostmanImportMode = "folder" | "request"

export interface PostmanImportOptions {
  readonly workspaceId: string
  readonly mode?: PostmanImportMode | undefined
  /** A Postman environment export, layered over the collection variables. */
  readonly environment?: unknown
}

export interface PostmanConversion {
  readonly bundle: ProjectBundle
  readonly preview: PostmanImportPreview
}

/** A key/value row as a node stores it (no `active`: disabled Postman rows are not imported). */
type KeyValuePair = { key: string; value: string }

// ── Postman v2.1 schema (the subset read here; unknown keys are dropped) ──────

const KeyValueSchema = z.object({
  key: z.string().nullish(),
  value: z.unknown().optional(),
  disabled: z.boolean().optional(),
  type: z.string().optional(),
})
type PostmanKeyValue = z.infer<typeof KeyValueSchema>

const AuthSchema = z.object({ type: z.string() }).catchall(z.unknown())
type PostmanAuth = z.infer<typeof AuthSchema>

const DescriptionSchema = z.union([z.string(), z.object({ content: z.string().optional() })]).nullish()

const UrlSchema = z.union([
  z.string(),
  z.object({
    raw: z.string().optional(),
    query: z.array(KeyValueSchema).nullish(),
    variable: z.array(KeyValueSchema).nullish(),
  }),
])
type PostmanUrl = z.infer<typeof UrlSchema>

const BodySchema = z.object({
  mode: z.string().optional(),
  disabled: z.boolean().optional(),
  raw: z.string().optional(),
  urlencoded: z.array(KeyValueSchema).optional(),
  formdata: z.array(KeyValueSchema).optional(),
  graphql: z.object({ query: z.string().optional(), variables: z.string().optional() }).optional(),
  options: z.object({ raw: z.object({ language: z.string().optional() }).optional() }).optional(),
})
type PostmanBody = z.infer<typeof BodySchema>

const RequestSchema = z.union([
  z.string(),
  z.object({
    method: z.string().optional(),
    url: UrlSchema.optional(),
    header: z.union([z.array(KeyValueSchema), z.string()]).optional(),
    body: BodySchema.nullish(),
    auth: AuthSchema.nullish(),
  }),
])
type PostmanRequest = z.infer<typeof RequestSchema>

const EventSchema = z.object({
  listen: z.string(),
  disabled: z.boolean().optional(),
  script: z.object({ exec: z.union([z.array(z.string()), z.string()]).optional() }).optional(),
})
type PostmanEvent = z.infer<typeof EventSchema>

interface PostmanItem {
  readonly name?: string | undefined
  readonly description?: z.infer<typeof DescriptionSchema>
  readonly item?: readonly PostmanItem[] | undefined
  readonly request?: PostmanRequest | undefined
  readonly event?: readonly PostmanEvent[] | undefined
  readonly auth?: PostmanAuth | null | undefined
}

const ItemSchema: z.ZodType<PostmanItem> = z.lazy(() =>
  z.object({
    name: z.string().optional(),
    description: DescriptionSchema,
    item: z.array(ItemSchema).optional(),
    request: RequestSchema.optional(),
    event: z.array(EventSchema).optional(),
    auth: AuthSchema.nullish(),
  }),
)

const VariableSchema = z.object({
  key: z.string().optional(),
  value: z.unknown().optional(),
  type: z.string().optional(),
  disabled: z.boolean().optional(),
})

const CollectionSchema = z.object({
  info: z.object({ name: z.string(), schema: z.string(), description: DescriptionSchema }),
  item: z.array(ItemSchema),
  auth: AuthSchema.nullish(),
  event: z.array(EventSchema).optional(),
  variable: z.array(VariableSchema).optional(),
})
type PostmanCollection = z.infer<typeof CollectionSchema>

const EnvironmentSchema = z.object({
  name: z.string(),
  values: z.array(z.object({
    key: z.string(),
    value: z.unknown().optional(),
    type: z.string().optional(),
    enabled: z.boolean().optional(),
  })),
})

/** True for anything that claims to be a Postman collection (any version), so the caller routes it here for a precise error. */
export function isPostmanCollection(value: unknown): boolean {
  if (!isRecord(value)) return false
  const info = value["info"]
  if (isRecord(info) && typeof info["schema"] === "string") return info["schema"].includes("getpostman.com")
  return isPostmanV1(value)
}

function isPostmanV1(value: Record<string, unknown>): boolean {
  return !isRecord(value["info"]) && Array.isArray(value["requests"])
}

const REEXPORT_HINT = "Re-export it from Postman as Collection v2.1 (… → Export → Collection v2.1)."

function parseCollection(input: unknown): PostmanCollection {
  if (!isRecord(input)) throw new ValidationError("A Postman collection must be a JSON object")
  if (isPostmanV1(input)) throw new ValidationError(`This is a Postman Collection v1 file, which APIWeave does not import. ${REEXPORT_HINT}`)
  const info = input["info"]
  const schema = isRecord(info) && typeof info["schema"] === "string" ? info["schema"] : ""
  if (schema.includes("/v2.0.")) throw new ValidationError(`This is a Postman Collection v2.0 file. ${REEXPORT_HINT}`)
  if (!schema.includes("/v2.1.")) {
    throw new ValidationError(`Not a Postman Collection v2.1 file: info.schema must name collection/v2.1.0. ${REEXPORT_HINT}`)
  }
  const parsed = CollectionSchema.safeParse(input)
  if (!parsed.success) throw new ValidationError(`Invalid Postman collection: ${formatIssue(parsed.error.issues[0])}`)
  return parsed.data
}

function parseEnvironment(input: unknown): z.infer<typeof EnvironmentSchema> {
  const parsed = EnvironmentSchema.safeParse(input)
  if (!parsed.success) throw new ValidationError(`Invalid Postman environment: ${formatIssue(parsed.error.issues[0])}`)
  return parsed.data
}

function formatIssue(issue: { readonly path: readonly PropertyKey[]; readonly message: string } | undefined): string {
  if (issue === undefined) return "invalid value"
  return issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message
}

// ── Mapping tables ────────────────────────────────────────────────────────────

const METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"])

/** Postman dynamic variables with an APIWeave dynamic function that produces the same kind of value. */
const DYNAMIC_VARIABLES: Readonly<Record<string, string>> = {
  $guid: "uuid()",
  $randomUUID: "uuid()",
  $timestamp: "timestamp()",
  $isoTimestamp: "iso_timestamp()",
  // ponytail: Postman's is 0–1000, randomNumber(3) is 100–999. Close enough for test data.
  $randomInt: "randomNumber(3)",
  $randomEmail: "randomEmail()",
  $randomExampleEmail: "randomEmail()",
  $randomAlphaNumeric: "randomString(1)",
  $randomHexadecimal: "randomHex(1)",
  $randomBoolean: "randomChoice(true,false)",
}

const RAW_CONTENT_TYPES: Readonly<Record<string, string>> = {
  text: "text/plain",
  javascript: "application/javascript",
  html: "text/html",
  xml: "application/xml",
}

const PLACEHOLDER_RE = /\{\{([^{}]+)\}\}/g
const AUTH_SCHEME_RE = /^(Bearer|Basic|Token|Digest)\s+/i

// ── Script conversion ─────────────────────────────────────────────────────────

const STATUS_PATTERNS = [
  /pm\.response\.to\.have\.status\(\s*(\d{3})\s*\)\s*;?/g,
  /pm\.expect\(\s*pm\.response\.code\s*\)\.to\.(?:eql|equal|eq|be\.equal)\(\s*(\d{3})\s*\)\s*;?/g,
]
const JSON_ALIAS_RE = /\b(?:var|let|const)\s+([A-Za-z_$][\w$]*)\s*=\s*pm\.response\.json\(\)\s*;?/g
const SET_VARIABLE_RE = /pm\.(?:environment|collectionVariables|variables|globals)\.set\(\s*(["'`])([^"'`]+)\1\s*,\s*(.+?)\s*\)\s*;?[ \t]*$/gm
const RESPONSE_PATH_RE = /^(?:([A-Za-z_$][\w$]*)|pm\.response\.json\(\))((?:\.[A-Za-z_$][\w$]*|\[\d+\])*)$/
const TEST_WRAPPER_RE = /pm\.test\(\s*(["'`])(?:(?!\1)[^\\]|\\.)*\1\s*,/g

/** What a test script says that APIWeave can express without running it. */
export interface TestScriptConversion {
  readonly expectedStatus: readonly number[]
  /** Variable name (as written in Postman) → extractor path. */
  readonly extractors: ReadonlyMap<string, string>
  /** True when nothing else was in the script, so it need not be kept. */
  readonly complete: boolean
}

/**
 * Recognises status checks and `pm.*.set("x", <response JSON path>)`; every
 * other line makes the script incomplete. Not an interpreter: a pattern it
 * does not know is left for the user, never guessed at.
 */
export function convertTestScript(script: string): TestScriptConversion {
  let rest = script
  const expectedStatus: number[] = []
  for (const pattern of STATUS_PATTERNS) {
    rest = rest.replace(pattern, (match, code: string) => {
      const status = Number(code)
      if (status < 100 || status > 599) return match
      if (!expectedStatus.includes(status)) expectedStatus.push(status)
      return ""
    })
  }
  const aliases = new Set<string>()
  rest = rest.replace(JSON_ALIAS_RE, (_match, alias: string) => {
    aliases.add(alias)
    return ""
  })
  const extractors = new Map<string, string>()
  rest = rest.replace(SET_VARIABLE_RE, (match, _quote: string, name: string, expression: string) => {
    const path = RESPONSE_PATH_RE.exec(expression.trim())
    if (path === null || (path[1] !== undefined && !aliases.has(path[1]))) return match
    extractors.set(name, `response.body${path[2] ?? ""}`)
    return ""
  })
  const leftover = rest
    .replace(TEST_WRAPPER_RE, "")
    .replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, "")
    .replace(/function\s*\(\s*\)|\(\s*\)\s*=>/g, "")
    .replace(/[\s{}();,]/g, "")
  return { expectedStatus, extractors, complete: leftover === "" }
}

// ── Conversion ────────────────────────────────────────────────────────────────

interface AuthOwner {
  readonly auth: PostmanAuth
  readonly owner: string
}

interface PlannedRequest {
  readonly item: PostmanItem
  readonly auth: AuthOwner | null
}

interface PlannedWorkflow {
  readonly name: string
  readonly description: string
  readonly requests: readonly PlannedRequest[]
}

interface BuiltWorkflow {
  readonly name: string
  readonly description: string
  readonly nodes: JsonValue[]
  readonly edges: JsonValue[]
  /** Postman variable names this workflow's own scripts set (they become workflow variables). */
  readonly setVariables: ReadonlySet<string>
  readonly requestCount: number
}

export function convertPostmanCollection(input: unknown, options: PostmanImportOptions): PostmanConversion {
  const collection = parseCollection(input)
  const environment = options.environment === undefined ? undefined : parseEnvironment(options.environment)
  return new PostmanConverter(collection, environment, options).convert()
}

class PostmanConverter {
  private readonly warnings = new Set<string>()
  private readonly requiredSecrets = new Map<string, string>()
  private readonly literalSecrets = new Map<string, string>()
  /** Variables read by a credential slot: their values are credentials, so they become secrets. */
  private readonly credentialVariables = new Set<string>()
  /** Variables any script sets, and the workflow that sets them. */
  private readonly setAnywhere = new Map<string, string>()
  private readonly convertedAuth = new Map<PostmanAuth, JsonValue | null>()
  private readonly values = new Map<string, JsonValue>()
  private readonly secretTyped = new Set<string>()
  private readonly envReferenced = new Set<string>()
  private nodeCount = 0

  constructor(
    private readonly collection: PostmanCollection,
    private readonly environment: z.infer<typeof EnvironmentSchema> | undefined,
    private readonly options: PostmanImportOptions,
  ) {
    // Postman's own precedence: an environment value wins over a collection variable.
    for (const variable of collection.variable ?? []) {
      if (variable.disabled === true || !variable.key) continue
      this.values.set(variable.key, toJsonScalar(variable.value))
      if (variable.type === "secret") this.secretTyped.add(variable.key)
    }
    for (const value of environment?.values ?? []) {
      if (value.enabled === false || !value.key) continue
      this.values.set(value.key, toJsonScalar(value.value))
      if (value.type === "secret") this.secretTyped.add(value.key)
    }
  }

  convert(): PostmanConversion {
    const name = this.collection.info.name.trim() || "Postman collection"
    const plans = this.plan(this.collection.item, [], this.ownerOf(this.collection.auth, `collection "${name}"`, null), name, "")
    if (plans.length === 0) throw new ValidationError("The Postman collection has no requests to import")
    const built = plans.map((plan) => this.buildWorkflow(plan))
    // Credential variables are only all known once every request is built.
    const workflows = built.map((workflow) => this.resolvePlaceholders(workflow))

    const environmentVariables = this.environmentVariables()
    const environmentName = `Postman: ${this.environment?.name ?? name}`
    const hasEnvironment = Object.keys(environmentVariables).length > 0 || this.environment !== undefined
    const environmentId = hasEnvironment ? "postman_environment" : null
    const environments: ExportedEnvironment[] = environmentId === null ? [] : [{
      environmentId,
      name: environmentName,
      description: `Imported from Postman${this.environment ? ` environment "${this.environment.name}" and` : ""} collection "${name}"`,
      scopeType: "workspace",
      scopeId: this.options.workspaceId,
      variables: environmentVariables,
      swaggerDocUrl: null,
    }]

    const exported: ExportedWorkflow[] = workflows.map((workflow, index) => ({
      workflowId: `postman_workflow_${index}`,
      name: workflow.name,
      description: workflow.description,
      nodes: workflow.nodes,
      edges: workflow.edges,
      variables: this.workflowVariables(workflow.setVariables),
      tags: ["postman-import"],
      selectedEnvironmentId: environmentId,
      nodeTemplates: [],
    }))

    const requiredSecrets: PostmanRequiredSecret[] = [...this.requiredSecrets]
      .map(([secretName, usedBy]) => ({ name: secretName, usedBy }))
      .sort((left, right) => left.name.localeCompare(right.name))
    const collectionScripts = scriptsText(this.collection.event, "Collection")
    if (collectionScripts !== "") this.warnings.add(`Collection-level scripts are not converted; they are kept in the project description`)

    const bundle: ProjectBundle = {
      schemaVersion: SCHEMA_VERSION,
      type: "awecollection",
      project: {
        projectId: "postman_collection",
        name,
        description: joinText(descriptionText(this.collection.info.description), collectionScripts),
        color: "#3B82F6",
      },
      workflows: exported,
      environments,
      secretReferences: requiredSecrets.map((secret) => ({ name: secret.name, scopeType: "workspace", scopeId: this.options.workspaceId })),
      metadata: {
        exportedAt: new Date().toISOString(),
        schemaVersion: SCHEMA_VERSION,
        workflowCount: exported.length,
        environmentCount: environments.length,
        secretReferenceCount: requiredSecrets.length,
      },
    }
    return {
      bundle,
      preview: {
        projectName: name,
        workflows: workflows.map((workflow) => ({ name: workflow.name, requestCount: workflow.requestCount })),
        environment: environmentId === null ? null : { name: environmentName, variableCount: Object.keys(environmentVariables).length },
        requiredSecrets,
        warnings: [...this.warnings],
      },
    }
  }

  // -------- Planning: which requests go into which workflow --------

  private plan(items: readonly PostmanItem[], path: readonly string[], auth: AuthOwner | null, name: string, description: string): PlannedWorkflow[] {
    const plans: PlannedWorkflow[] = []
    const requests = items
      .filter((item) => item.item === undefined && item.request !== undefined)
      .map((item) => {
        const requestName = item.name?.trim() || "Request"
        const own = typeof item.request === "string" ? undefined : item.request?.auth
        return { requestName, request: { item, auth: this.ownerOf(own, `request "${requestName}"`, auth) } }
      })
    if (this.options.mode === "request") {
      for (const { requestName, request } of requests) {
        plans.push({ name: [...path, requestName].join(" / "), description: descriptionText(request.item.description), requests: [request] })
      }
    } else if (requests.length > 0) {
      plans.push({ name, description, requests: requests.map(({ request }) => request) })
    }
    for (const folder of items) {
      if (folder.item === undefined) continue
      const folderName = folder.name?.trim() || "Folder"
      const folderPath = [...path, folderName]
      const scripts = scriptsText(folder.event, `Folder "${folderName}"`)
      if (scripts !== "") this.warnings.add(`Folder "${folderName}": folder-level scripts are not converted; they are kept in the workflow description`)
      const folderAuth = this.ownerOf(folder.auth, `folder "${folderName}"`, auth)
      plans.push(...this.plan(folder.item, folderPath, folderAuth, folderPath.join(" / "), joinText(descriptionText(folder.description), scripts)))
    }
    return plans
  }

  /** The auth an item uses: its own, or the one it inherits. */
  private ownerOf(auth: PostmanAuth | null | undefined, owner: string, inherited: AuthOwner | null): AuthOwner | null {
    if (auth === undefined || auth === null || auth.type === "inherit") return inherited
    return { auth, owner }
  }

  private nextNodeId(): string {
    this.nodeCount += 1
    return `postman_node_${this.nodeCount}`
  }

  // -------- Building a workflow with Postman-style {{placeholders}} --------

  private buildWorkflow(plan: PlannedWorkflow): BuiltWorkflow {
    const start = makeStartNode()
    const httpNodes: JsonValue[] = []
    const httpIds: string[] = []
    const setVariables = new Set<string>()
    const notes: string[] = []
    plan.requests.forEach((request, index) => {
      const node = this.buildRequestNode(request, index, setVariables, notes, plan.name)
      httpNodes.push(node.node)
      httpIds.push(node.nodeId)
    })
    for (const name of setVariables) if (!this.setAnywhere.has(name)) this.setAnywhere.set(name, plan.name)
    const end = makeEndNode(plan.requests.length)
    const nodes: JsonValue[] = [toJson(start), ...httpNodes, toJson(end)]
    if (notes.length > 0) {
      nodes.push({
        nodeId: this.nextNodeId(),
        type: "note",
        label: "Postman scripts",
        position: { x: 100, y: end.position.y + 300 },
        config: {
          content: `Postman scripts APIWeave did not convert. They are kept for reference; nothing in this note runs.\n\n${notes.join("\n\n")}`,
        },
      })
    }
    return {
      name: plan.name,
      description: plan.description,
      nodes,
      edges: chainEdges(start.nodeId, httpIds, end.nodeId).map(toJson),
      setVariables,
      requestCount: plan.requests.length,
    }
  }

  private buildRequestNode(
    planned: PlannedRequest,
    index: number,
    setVariables: Set<string>,
    notes: string[],
    workflowName: string,
  ): { node: JsonValue; nodeId: string } {
    const name = planned.item.name?.trim() || "Request"
    const request = typeof planned.item.request === "string" ? { url: planned.item.request } : planned.item.request ?? {}
    const where = `"${workflowName}" › "${name}"`

    const method = this.convertMethod(request.method, where)
    const { url, queryParams, pathVariables } = this.convertUrl(request.url ?? "", name)
    const headers = this.convertHeaders(request.header, name)

    const config: Record<string, JsonValue> = { method, url, headers, queryParams, cookies: [], timeout: 30, followRedirects: true }
    if (pathVariables.length > 0) config["pathVariables"] = pathVariables
    this.convertBody(request.body ?? undefined, name, where, headers, config)

    if (planned.auth !== null) {
      const auth = this.convertAuth(planned.auth)
      if (auth !== null) config["auth"] = auth
    }

    this.convertScripts(planned.item.event ?? [], name, where, setVariables, notes, config)

    const nodeId = this.nextNodeId()
    return {
      nodeId,
      node: { nodeId, type: "http-request", label: name, position: positionForIndex(index), config },
    }
  }

  private convertMethod(method: string | undefined, where: string): string {
    const rawMethod = (method ?? "GET").toUpperCase()
    if (METHODS.has(rawMethod)) return rawMethod
    this.warnings.add(`${where}: method ${rawMethod} is not supported; imported as GET`)
    return "GET"
  }

  private convertHeaders(header: readonly PostmanKeyValue[] | string | undefined, name: string): KeyValuePair[] {
    const headers: KeyValuePair[] = []
    for (const row of Array.isArray(header) ? header : []) {
      if (row.disabled === true || !row.key) continue
      const value = stringValue(row.value)
      const credential = isSecretKey(row.key) || containsCredentialMaterial(value)
      headers.push({ key: row.key, value: credential ? this.credential(value, `${name} ${row.key}`, true) : value })
    }
    return headers
  }

  /** Test scripts become `expectedStatus` and extractors where they can; whatever is left is kept in a note. */
  private convertScripts(
    events: readonly PostmanEvent[],
    name: string,
    where: string,
    setVariables: Set<string>,
    notes: string[],
    config: Record<string, JsonValue>,
  ): void {
    const extractors: Record<string, string> = {}
    for (const event of events) {
      const script = eventScript(event)
      if (script === "") continue
      if (event.listen !== "test") {
        this.warnings.add(`${where}: ${event.listen} script not converted; its text is kept in a note on the canvas`)
      } else if (this.convertTest(script, where, setVariables, extractors, config)) {
        continue
      }
      notes.push(`### ${name} — ${event.listen} script\n\`\`\`js\n${keptScript(script)}\n\`\`\``)
    }
    config["extractors"] = extractors
  }

  /** Whether the test script converted completely; a partial one is warned about. */
  private convertTest(
    script: string,
    where: string,
    setVariables: Set<string>,
    extractors: Record<string, string>,
    config: Record<string, JsonValue>,
  ): boolean {
    const converted = convertTestScript(script)
    if (converted.expectedStatus.length > 0) {
      config["expectedStatus"] = converted.expectedStatus.length === 1 ? converted.expectedStatus[0]! : [...converted.expectedStatus]
    }
    for (const [variable, path] of converted.extractors) {
      extractors[safeName(variable)] = path
      setVariables.add(variable)
    }
    if (converted.complete) return true
    this.warnings.add(`${where}: test script ${converted.expectedStatus.length + converted.extractors.size > 0 ? "partly converted" : "not converted"}; its text is kept in a note on the canvas`)
    return false
  }

  private convertUrl(source: PostmanUrl, requestName: string): { url: string; queryParams: KeyValuePair[]; pathVariables: KeyValuePair[] } {
    const raw = typeof source === "string" ? source : source.raw ?? ""
    const queryStart = raw.indexOf("?")
    let url = (queryStart >= 0 ? raw.slice(0, queryStart) : raw).trim()
    const queryParams: KeyValuePair[] = []
    const pushQuery = (key: string, value: string): void => {
      queryParams.push({ key, value: isSecretKey(key) ? this.credential(value, `${requestName} ${key}`) : value })
    }
    if (typeof source !== "string" && source.query) {
      for (const query of source.query) if (query.disabled !== true && query.key) pushQuery(query.key, stringValue(query.value))
    } else if (queryStart >= 0) {
      for (const pair of raw.slice(queryStart + 1).split("#")[0]!.split("&")) {
        if (pair === "") continue
        const separator = pair.indexOf("=")
        pushQuery(separator < 0 ? pair : pair.slice(0, separator), separator < 0 ? "" : pair.slice(separator + 1))
      }
    }
    // `:id` path segments become `{id}`, which a node's path variables fill.
    const declared = new Map<string, string>()
    if (typeof source !== "string") {
      for (const variable of source.variable ?? []) if (variable.key) declared.set(variable.key, stringValue(variable.value))
    }
    const pathVariables: KeyValuePair[] = []
    url = url.replace(/\/:([A-Za-z_][\w-]*)/g, (_match, key: string) => {
      if (!pathVariables.some((variable) => variable.key === key)) pathVariables.push({ key, value: declared.get(key) ?? "" })
      return `/{${key}}`
    })
    return { url, queryParams, pathVariables }
  }

  private convertBody(body: PostmanBody | undefined, name: string, where: string, headers: KeyValuePair[], config: Record<string, JsonValue>): void {
    if (body === undefined || body.disabled === true || body.mode === undefined || body.mode === "none") return
    switch (body.mode) {
      case "raw":
        this.convertRawBody(body, name, headers, config)
        return
      case "urlencoded":
        config["bodyType"] = "x-www-form-urlencoded"
        config["urlEncodedEntries"] = this.formEntries(body.urlencoded ?? [], name, where).map(({ key, value }) => ({ key, value, active: true }))
        return
      case "formdata":
        config["bodyType"] = "form-data"
        config["formDataEntries"] = this.formEntries(body.formdata ?? [], name, where).map(({ key, value }) => ({ key, value, type: "text", active: true }))
        return
      case "graphql":
        this.convertGraphqlBody(body, name, config)
        return
      default:
        this.warnings.add(`${where}: ${body.mode} body is not supported; imported without a body`)
    }
  }

  private convertRawBody(body: PostmanBody, name: string, headers: KeyValuePair[], config: Record<string, JsonValue>): void {
    const language = body.options?.raw?.language ?? "text"
    const text = this.secureJsonText(body.raw ?? "", name)
    // A credential the key names did not reveal (a bearer token, a JWT): the whole body is withheld.
    config["body"] = containsCredentialMaterial(text) ? `{{secrets.${this.secretForLiteral(body.raw ?? "", `${name} body`)}}}` : text
    if (language === "json") {
      config["bodyType"] = "json"
      return
    }
    config["bodyType"] = "raw"
    const contentType = RAW_CONTENT_TYPES[language]
    if (contentType !== undefined && !headers.some((header) => header.key.toLowerCase() === "content-type")) {
      headers.push({ key: "Content-Type", value: contentType })
    }
  }

  private convertGraphqlBody(body: PostmanBody, name: string, config: Record<string, JsonValue>): void {
    const variables = this.secureJsonText(body.graphql?.variables?.trim() ?? "", name)
    config["bodyType"] = "graphql"
    config["graphql"] = { query: body.graphql?.query ?? "", ...(variables ? { variables } : {}) }
  }

  private formEntries(entries: readonly PostmanKeyValue[], name: string, where: string): KeyValuePair[] {
    const out: KeyValuePair[] = []
    for (const entry of entries) {
      if (entry.disabled === true || !entry.key) continue
      if (entry.type === "file") {
        this.warnings.add(`${where}: form-data file field "${entry.key}" skipped; add the file on the node`)
        continue
      }
      const value = stringValue(entry.value)
      out.push({ key: entry.key, value: isSecretKey(entry.key) ? this.credential(value, `${name} ${entry.key}`) : value })
    }
    return out
  }

  /**
   * Swap the string value of every credential-named JSON key for a secret
   * reference. A regex rather than JSON.parse, because a Postman body is often
   * not JSON until its `{{placeholders}}` are filled.
   */
  private secureJsonText(text: string, name: string): string {
    return text.replace(/"([^"\\]+)"(\s*:\s*)"((?:[^"\\]|\\.)*)"/g, (match, key: string, colon: string, value: string) =>
      isSecretKey(key) || containsCredentialMaterial(value) ? `"${key}"${colon}"${this.credential(value, `${name} ${key}`)}"` : match)
  }

  private convertAuth(owner: AuthOwner): JsonValue | null {
    const cached = this.convertedAuth.get(owner.auth)
    if (cached !== undefined) return cached
    const params = new Map<string, string>()
    const list = owner.auth[owner.auth.type]
    if (Array.isArray(list)) {
      for (const entry of list) {
        if (isRecord(entry) && typeof entry["key"] === "string") params.set(entry["key"], stringValue(entry["value"]))
      }
    }
    const label = (what: string): string => `${what} of ${owner.owner}`
    let converted: JsonValue | null = null
    switch (owner.auth.type) {
      case "noauth":
        break
      case "bearer":
        converted = { type: "bearer", bearer: { token: this.credential(params.get("token") ?? "", label("bearer token")) } }
        break
      case "basic":
        converted = {
          type: "basic",
          basic: { username: params.get("username") ?? "", password: this.credential(params.get("password") ?? "", label("basic auth password")) },
        }
        break
      case "apikey":
        converted = {
          type: "apiKey",
          apiKey: {
            key: params.get("key") ?? "",
            value: this.credential(params.get("value") ?? "", label("API key")),
            addTo: params.get("in") === "query" ? "query" : "header",
          },
        }
        break
      case "oauth2":
        converted = this.convertOAuth2(params, owner.owner, label)
        break
      default:
        this.warnings.add(`${owner.owner} uses ${owner.auth.type} auth, which APIWeave does not support; its requests are imported without auth`)
    }
    this.convertedAuth.set(owner.auth, converted)
    return converted
  }

  private convertOAuth2(params: ReadonlyMap<string, string>, owner: string, label: (what: string) => string): JsonValue | null {
    const grant = params.get("grant_type") || "authorization_code"
    const grantType = grant === "client_credentials"
      ? "client_credentials"
      : grant === "authorization_code" || grant === "authorization_code_with_pkce" ? "authorization_code" : null
    if (grantType === null) {
      this.warnings.add(`${owner} uses the OAuth 2.0 ${grant} grant, which APIWeave does not support; its requests are imported without auth`)
      return null
    }
    const oauth2: Record<string, JsonValue> = {
      grantType,
      tokenUrl: params.get("accessTokenUrl") ?? "",
      clientId: params.get("clientId") ?? "",
    }
    if (grantType === "authorization_code" && params.get("authUrl")) oauth2["authorizationUrl"] = params.get("authUrl")!
    const clientSecret = params.get("clientSecret") ?? ""
    if (clientSecret !== "") oauth2["clientSecret"] = this.secretReference(clientSecret, label("OAuth 2.0 client secret"))
    if (params.get("scope")) oauth2["scope"] = params.get("scope")!
    if (params.get("audience")) oauth2["audience"] = params.get("audience")!
    oauth2["clientAuth"] = params.get("client_authentication") === "body" ? "body" : "basic"
    return { type: "oauth2", oauth2 }
  }

  // -------- Credentials --------

  /**
   * A value in a credential slot: references stay (their variables become
   * secrets), a literal becomes a new secret. `keepScheme` keeps an
   * Authorization header's `Bearer ` in front of the reference.
   */
  private credential(value: string, label: string, keepScheme = false): string {
    if (value === "") return ""
    // What is left without the references and an auth scheme word; punctuation alone (`{{user}}:{{pass}}`) is no credential.
    const literal = value.replace(PLACEHOLDER_RE, "").replace(AUTH_SCHEME_RE, "").replace(/[^A-Za-z0-9]/g, "")
    if (literal === "") {
      for (const name of placeholderNames(value)) this.credentialVariables.add(name)
      return value
    }
    const scheme = keepScheme ? AUTH_SCHEME_RE.exec(value)?.[0] ?? "" : ""
    return `${scheme}{{secrets.${this.secretForLiteral(value.slice(scheme.length), label)}}}`
  }

  /** Exactly one `{{secrets.NAME}}`, as the OAuth 2.0 schema requires. */
  private secretReference(value: string, label: string): string {
    const names = placeholderNames(value)
    if (names.length === 1 && value.trim() === `{{${names[0]}}}`) {
      const name = names[0]!
      this.credentialVariables.add(name)
      const secret = safeName(name)
      this.requireSecret(secret, `variable {{${name}}}`)
      return `{{secrets.${secret}}}`
    }
    return `{{secrets.${this.secretForLiteral(value, label)}}}`
  }

  private secretForLiteral(literal: string, label: string): string {
    const known = this.literalSecrets.get(literal)
    if (known !== undefined) return known
    const base = label.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "SECRET"
    let name = /^[0-9]/.test(base) ? `_${base}` : base
    for (let suffix = 2; this.requiredSecrets.has(name); suffix++) name = `${base}_${suffix}`
    this.literalSecrets.set(literal, name)
    this.requireSecret(name, label)
    return name
  }

  private requireSecret(name: string, usedBy: string): void {
    if (!this.requiredSecrets.has(name)) this.requiredSecrets.set(name, usedBy)
  }

  private isSecretVariable(name: string): boolean {
    const value = this.values.get(name)
    return this.credentialVariables.has(name)
      || this.secretTyped.has(name)
      || isSecretKey(name)
      || (typeof value === "string" && containsCredentialMaterial(value))
  }

  // -------- Placeholders: Postman {{name}} → APIWeave scopes --------

  private resolvePlaceholders(workflow: BuiltWorkflow): BuiltWorkflow {
    const map = (name: string): string => this.placeholderFor(name, workflow)
    const nodes = workflow.nodes.map((node) => {
      if (!isRecord(node) || node["type"] !== "http-request") return node
      return { ...node, config: mapStrings(node["config"] as JsonValue, (text) => text.replace(PLACEHOLDER_RE, (match, raw: string) => {
        const name = raw.trim()
        return name.startsWith("secrets.") ? match : map(name)
      })) }
    })
    return { ...workflow, nodes }
  }

  private placeholderFor(name: string, workflow: BuiltWorkflow): string {
    if (name.startsWith("$")) {
      const fn = DYNAMIC_VARIABLES[name]
      if (fn !== undefined) return `{{${fn}}}`
      this.warnings.add(`Dynamic variable {{${name}}} has no APIWeave equivalent; it is left as is`)
      return `{{${name}}}`
    }
    const safe = safeName(name)
    if (safe !== name) this.warnings.add(`Variable {{${name}}} is renamed ${safe}: APIWeave names use letters, digits and underscores`)
    if (workflow.setVariables.has(name)) return `{{variables.${safe}}}`
    const setter = this.setAnywhere.get(name)
    if (setter !== undefined) {
      this.warnings.add(`"${workflow.name}" reads {{${name}}}, which a script in "${setter}" sets; variables do not pass between workflows, so it reads the ${this.isSecretVariable(name) ? "secret" : "environment"} instead`)
    }
    if (this.isSecretVariable(name)) {
      this.requireSecret(safe, `variable {{${name}}}`)
      return `{{secrets.${safe}}}`
    }
    this.envReferenced.add(name)
    return `{{env.${safe}}}`
  }

  private environmentVariables(): Record<string, JsonValue> {
    const variables: Record<string, JsonValue> = {}
    for (const [name, value] of this.values) {
      if (!this.isSecretVariable(name)) variables[safeName(name)] = value
    }
    for (const name of this.envReferenced) {
      if (this.values.has(name)) continue
      variables[safeName(name)] = ""
      this.warnings.add(`Variable {{${name}}} has no value in the collection${this.environment ? " or environment" : ""}; set it in the imported environment`)
    }
    return variables
  }

  private workflowVariables(names: ReadonlySet<string>): Record<string, JsonValue> {
    const variables: Record<string, JsonValue> = {}
    for (const name of names) {
      variables[safeName(name)] = this.isSecretVariable(name) ? "" : this.values.get(name) ?? ""
    }
    return variables
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function placeholderNames(text: string): string[] {
  return [...text.matchAll(PLACEHOLDER_RE)].map((match) => match[1]!.trim()).filter((name) => !name.startsWith("$"))
}

function mapStrings(value: JsonValue, map: (text: string) => string): JsonValue {
  if (typeof value === "string") return map(value)
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, map))
  if (isRecord(value)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapStrings(item as JsonValue, map)]))
  return value
}

function eventScript(event: PostmanEvent): string {
  if (event.disabled === true) return ""
  const exec = event.script?.exec ?? ""
  const text = (Array.isArray(exec) ? exec.join("\n") : exec).replace(/\r\n/g, "\n")
  return text.trim() === "" ? "" : text
}

function scriptsText(events: readonly PostmanEvent[] | undefined, owner: string): string {
  return (events ?? [])
    .map((event) => ({ listen: event.listen, script: eventScript(event) }))
    .filter((event) => event.script !== "")
    .map((event) => `${owner} ${event.listen} script (not converted):\n${keptScript(event.script)}`)
    .join("\n\n")
}

/**
 * Script text as kept for the user to read.
 * ponytail: catches bearer tokens, JWTs and live keys only; a password typed as a
 * plain string literal in a script still survives. Parse string literals if that matters.
 */
function keptScript(script: string): string {
  return containsCredentialMaterial(script) ? "// Withheld: this script holds what looks like a credential." : script
}

function descriptionText(description: z.infer<typeof DescriptionSchema>): string {
  if (typeof description === "string") return description
  return description?.content ?? ""
}

function joinText(...parts: readonly string[]): string {
  return parts.filter((part) => part.trim() !== "").join("\n\n")
}

function stringValue(value: unknown): string {
  if (value === undefined || value === null) return ""
  return typeof value === "string" ? value : JSON.stringify(value)
}

function toJsonScalar(value: unknown): JsonValue {
  if (value === undefined || value === null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value
  return JSON.stringify(value)
}

function toJson(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
