import { parse as parseYaml } from "yaml"
import type { KeyValuePair } from "@shared/zod-schemas/KeyValuePairSchema"
import { detectSecretsInValue } from "./secret_utils"

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "HEAD" | "OPTIONS"

export type ImportedNode =
  | StartNode
  | HttpRequestNode
  | EndNode

export interface StartNode {
  readonly nodeId: string
  readonly type: "start"
  readonly label: string
  readonly position: { readonly x: number; readonly y: number }
  readonly config: Record<string, never>
}

export interface HttpRequestNode {
  readonly nodeId: string
  readonly type: "http-request"
  readonly label: string
  readonly position: { readonly x: number; readonly y: number }
  readonly config: {
    readonly method: HttpMethod
    readonly url: string
    readonly headers: KeyValuePair[]
    readonly queryParams: KeyValuePair[]
    readonly cookies: KeyValuePair[]
    readonly body?: string | undefined
    readonly timeout: number
    readonly followRedirects: boolean
    readonly extractors: Record<string, string>
  }
}

export interface EndNode {
  readonly nodeId: string
  readonly type: "end"
  readonly label: string
  readonly position: { readonly x: number; readonly y: number }
  readonly config: Record<string, never>
}

export interface ImportedEdge {
  readonly edgeId: string
  readonly source: string
  readonly target: string
  readonly label: null
}

export interface ParsedWorkflow {
  readonly name: string
  readonly description: string
  readonly nodes: readonly ImportedNode[]
  readonly edges: readonly ImportedEdge[]
  readonly variables: Record<string, never>
  readonly tags: readonly string[]
}

export interface OpenApiParseOptions {
  readonly baseUrl?: string
  readonly tagFilter?: readonly string[]
  readonly sanitize?: boolean
}

export interface HarParseOptions {
  readonly importMode?: "linear" | "grouped"
  readonly sanitize?: boolean
}

export interface CurlParseOptions {
  readonly sanitize?: boolean
}

export interface HarPreviewEntry {
  readonly method: string
  readonly url: string
  readonly headers: string
  readonly body: string
  readonly time: number
}

export interface HarDryRunResult {
  readonly stats: { readonly totalEntries: number; readonly nodes: number; readonly edges: number }
  readonly preview: readonly HarPreviewEntry[]
  readonly items: readonly HarPreviewEntry[]
}

export interface CurlDryRunResult {
  readonly stats: { readonly totalRequests: number }
  readonly workflow: { readonly name: string; readonly nodeCount: number; readonly edgeCount: number }
}

export interface OpenApiPreviewData {
  readonly nodes: readonly ImportedNode[]
  readonly availableServers: readonly { readonly url: string; readonly description: string }[]
  readonly availableTags: readonly { readonly name: string; readonly description: string }[]
  readonly stats: { readonly apiTitle: string; readonly apiVersion: string; readonly totalEndpoints: number }
  readonly workflow: { readonly nodeCount: number }
}

export interface SwaggerDiscoveryResult {
  readonly spec: Record<string, unknown>
  readonly sourceUrl: string
  readonly warnings: readonly string[]
}

let idCounter = 0
function newId(): string {
  idCounter += 1
  return `import_${Date.now()}_${idCounter}`
}

export function resetIdCounter(): void {
  idCounter = 0
}

const NODES_PER_ROW = 8
const X_SPACING = 400
const Y_SPACING = 200
const START_X = 600
const START_Y = 100

function positionForIndex(idx: number): { x: number; y: number } {
  const row = Math.floor(idx / NODES_PER_ROW)
  const col = idx % NODES_PER_ROW
  return { x: START_X + col * X_SPACING, y: START_Y + row * Y_SPACING }
}

function kvToString(kv: Record<string, string>): string {
  return Object.entries(kv)
    .map(([k, v]) => `${k}=${v}`)
    .join("\n")
}

function kvToPairs(kv: Record<string, string>): KeyValuePair[] {
  return Object.entries(kv).map(([key, value]) => ({ key, value }))
}

function truncate(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 3)}...`
}

function normalizeMethod(method: string | undefined): HttpMethod {
  const upper = (method ?? "GET").toUpperCase()
  if (upper === "POST" || upper === "PUT" || upper === "PATCH" || upper === "DELETE" || upper === "HEAD" || upper === "OPTIONS") {
    return upper
  }
  return "GET"
}

function makeStartNode(): StartNode {
  return {
    nodeId: newId(),
    type: "start",
    label: "Start",
    position: { x: 100, y: 100 },
    config: {},
  }
}

function makeEndNode(httpCount: number): EndNode {
  const totalRows = Math.ceil((httpCount + 1) / NODES_PER_ROW)
  return {
    nodeId: newId(),
    type: "end",
    label: "End",
    position: { x: START_X + (NODES_PER_ROW / 2) * X_SPACING, y: START_Y + totalRows * Y_SPACING + Y_SPACING },
    config: {},
  }
}

function chainEdges(startId: string, httpIds: readonly string[], endId: string): ImportedEdge[] {
  const edges: ImportedEdge[] = []
  let prev = startId
  for (const id of httpIds) {
    edges.push({ edgeId: newId(), source: prev, target: id, label: null })
    prev = id
  }
  edges.push({ edgeId: newId(), source: prev, target: endId, label: null })
  return edges
}

// ── cURL ──────────────────────────────────────────────────────────────────────

export function parseCurlCommands(input: string, opts: CurlParseOptions = {}): ParsedWorkflow {
  const sanitize = opts.sanitize ?? true
  const commands = splitCurlCommands(input)
  if (commands.length === 0) throw new Error("No valid curl commands found")

  const start = makeStartNode()
  const httpNodes: HttpRequestNode[] = []
  for (let i = 0; i < commands.length; i++) {
    const node = parseOneCurl(commands[i]!, sanitize, httpNodes.length)
    if (node) httpNodes.push(node)
  }
  const end = makeEndNode(httpNodes.length)

  const allNodes: ImportedNode[] = [start, ...httpNodes, end]
  const httpIds = httpNodes.map((n) => n.nodeId)
  const edges = chainEdges(start.nodeId, httpIds, end.nodeId)

  const now = new Date().toISOString().replace("T", " ").slice(0, 16)
  return {
    name: `Imported from curl - ${now}`,
    description: `Imported ${httpNodes.length} HTTP requests from curl commands`,
    nodes: allNodes,
    edges,
    variables: {},
    tags: ["curl-import"],
  }
}

function splitCurlCommands(input: string): string[] {
  const commands: string[] = []
  const current: string[] = []

  const flush = () => {
    if (current.length > 0) {
      const normalized = normalizeCurl(current.join("\n"))
      if (normalized) commands.push(normalized)
      current.length = 0
    }
  }

  for (const line of input.split("\n")) {
    const stripped = line.trim()
    if (!stripped) continue
    if (stripped.startsWith("curl")) {
      flush()
      current.push(line)
    } else {
      current.push(line)
    }
  }
  flush()

  const expanded: string[] = []
  for (const cmd of commands) {
    for (const part of cmd.split("&&")) {
      const trimmed = part.trim()
      if (trimmed.startsWith("curl")) expanded.push(trimmed)
    }
  }
  return expanded
}

function normalizeCurl(cmd: string): string {
  return cmd.replace(/\\\s*\n\s*/g, " ").trim()
}

function parseOneCurl(raw: string, sanitize: boolean, idx: number): HttpRequestNode | null {
  try {
    let cmd = raw
    if (cmd.startsWith("curl ")) cmd = cmd.slice(5).trim()
    const tokens = shellSplit(cmd)

    let method: HttpMethod = "GET"
    let url: string | null = null
    const headers: Record<string, string> = {}
    const cookies: Record<string, string> = {}
    let body: string | undefined

    let i = 0
    while (i < tokens.length) {
      const token = tokens[i] ?? ""
      if (!token) { i++; continue }
      if (token === "-X" || token === "--request") {
        if (i + 1 < tokens.length) { method = normalizeMethod(tokens[i + 1]); i += 2; continue }
      } else if (token === "-u" || token === "--url") {
        if (i + 1 < tokens.length) { url = tokens[i + 1] ?? null; i += 2; continue }
      } else if (token === "-H" || token === "--header") {
        if (i + 1 < tokens.length) {
          const h = tokens[i + 1] ?? ""
          const colonIdx = h.indexOf(":")
          if (colonIdx > 0) {
            const k = h.slice(0, colonIdx).trim()
            const v = h.slice(colonIdx + 1).trim()
            headers[k] = sanitize && detectSecretsInValue(`${k}:${v}`) ? "[FILTERED]" : v
          }
          i += 2; continue
        }
      } else if (token === "-b" || token === "--cookie") {
        if (i + 1 < tokens.length) {
          for (const part of (tokens[i + 1] ?? "").split(";")) {
            const eq = part.trim().indexOf("=")
            if (eq > 0) {
              const k = part.trim().slice(0, eq)
              const v = part.trim().slice(eq + 1)
              cookies[k] = sanitize && (detectSecretsInValue(`${k}=${v}`) || detectSecretsInValue(v)) ? "[FILTERED]" : v
            }
          }
          i += 2; continue
        }
      } else if (token === "-d" || token === "--data" || token === "--data-raw") {
        if (i + 1 < tokens.length) {
          const raw = tokens[i + 1] ?? ""
          body = sanitize && detectSecretsInValue(raw) ? "[FILTERED]" : raw
          if (method === "GET") method = "POST"
          i += 2; continue
        }
      } else if (!token.startsWith("-") && url === null) {
        url = token; i++; continue
      }
      i++
    }

    if (!url) return null

    const parsed = new URL(url)
    const host = parsed.host
    const path = parsed.pathname || "/"
    const queryParams: Record<string, string> = {}
    parsed.searchParams.forEach((v, k) => { queryParams[k] = v })

    const label = `[${method}] ${host}${truncate(path, 40)}`
    const pos = positionForIndex(idx)

    const config: HttpRequestNode["config"] = {
      method,
      url,
      headers: kvToPairs(headers),
      queryParams: kvToPairs(queryParams),
      cookies: kvToPairs(cookies),
      timeout: 30,
      followRedirects: true,
      extractors: {},
      ...(body !== undefined ? { body } : {}),
    }

    return {
      nodeId: newId(),
      type: "http-request",
      label,
      position: pos,
      config,
    }
  } catch {
    return null
  }
}

function shellSplit(cmd: string): string[] {
  const tokens: string[] = []
  let current = ""
  let inQuote: string | null = null
  for (const ch of cmd) {
    if (inQuote) {
      if (ch === inQuote) { inQuote = null } else { current += ch }
    } else if (ch === "'" || ch === '"') {
      inQuote = ch
    } else if (ch === " " || ch === "\t") {
      if (current) { tokens.push(current); current = "" }
    } else {
      current += ch
    }
  }
  if (current) tokens.push(current)
  return tokens
}

// ── HAR ───────────────────────────────────────────────────────────────────────

export function parseHarData(data: Record<string, unknown>, opts: HarParseOptions = {}): ParsedWorkflow {
  const sanitize = opts.sanitize ?? true
  const log = data["log"] as Record<string, unknown> | undefined
  const entries = ((log?.["entries"]) as Record<string, unknown>[] | undefined) ?? []
  if (entries.length === 0) throw new Error("HAR file contains no entries")

  const start = makeStartNode()
  const httpNodes: HttpRequestNode[] = []

  for (let idx = 0; idx < entries.length; idx++) {
    const entry = entries[idx]!
    const request = (entry["request"] ?? {}) as Record<string, unknown>
    const response = (entry["response"] ?? {}) as Record<string, unknown>
    const method = normalizeMethod(request["method"] as string | undefined)
    const url = (request["url"] as string) ?? ""

    const parsed = safeUrl(url)
    const host = parsed?.host ?? ""
    const path = parsed?.pathname ?? "/"
    const queryParams: Record<string, string> = {}

    const harQs = (request["queryString"] as { name?: string; value?: string }[]) ?? []
    if (harQs.length > 0) {
      for (const qp of harQs) queryParams[qp.name ?? ""] = qp.value ?? ""
    } else if (parsed?.search) {
      parsed.searchParams.forEach((v, k) => { queryParams[k] = v })
    }

    const headers: Record<string, string> = {}
    for (const h of ((request["headers"] as { name?: string; value?: string }[]) ?? [])) {
      const k = h.name ?? ""
      const v = h.value ?? ""
      headers[k] = sanitize && detectSecretsInValue(`${k}:${v}`) ? "[FILTERED]" : v
    }

    const cookies: Record<string, string> = {}
    for (const ck of ((request["cookies"] as { name?: string; value?: string }[]) ?? [])) {
      const k = ck.name ?? ""
      const v = ck.value ?? ""
      cookies[k] = sanitize && (detectSecretsInValue(`${k}=${v}`) || detectSecretsInValue(v)) ? "[FILTERED]" : v
    }

    const postData = (request["postData"] ?? {}) as Record<string, unknown>
    const rawBody = (postData["text"] as string) ?? ""
    const body = sanitize && rawBody && detectSecretsInValue(rawBody) ? "[FILTERED]" : rawBody

    void response

    const label = `[${method}] ${host}${truncate(path, 40)}`
    const pos = positionForIndex(idx)

    const config: HttpRequestNode["config"] = {
      method,
      url,
      headers: kvToPairs(headers),
      queryParams: kvToPairs(queryParams),
      cookies: kvToPairs(cookies),
      timeout: 30,
      followRedirects: true,
      extractors: {},
      ...(body ? { body } : {}),
    }

    httpNodes.push({
      nodeId: newId(),
      type: "http-request",
      label,
      position: pos,
      config,
    })
  }

  const end = makeEndNode(httpNodes.length)
  const allNodes: ImportedNode[] = [start, ...httpNodes, end]
  const httpIds = httpNodes.map((n) => n.nodeId)
  const edges = chainEdges(start.nodeId, httpIds, end.nodeId)

  const now = new Date().toISOString().replace("T", " ").slice(0, 16)
  return {
    name: `Imported from HAR - ${now}`,
    description: `Imported ${entries.length} HTTP requests from HAR file`,
    nodes: allNodes,
    edges,
    variables: {},
    tags: ["har-import"],
  }
}

export function harDryRun(data: Record<string, unknown>, opts: HarParseOptions = {}): HarDryRunResult {
  const sanitize = opts.sanitize ?? true
  const log = data["log"] as Record<string, unknown> | undefined
  const entries = ((log?.["entries"]) as Record<string, unknown>[] | undefined) ?? []

  const toPreviewEntry = (entry: Record<string, unknown>): HarPreviewEntry => {
    const request = (entry["request"] ?? {}) as Record<string, unknown>
    const method = (request["method"] as string) ?? "GET"
    const url = (request["url"] as string) ?? ""

    const headers: Record<string, string> = {}
    for (const h of ((request["headers"] as { name?: string; value?: string }[]) ?? [])) {
      const k = h.name ?? ""
      const v = h.value ?? ""
      headers[k] = sanitize && detectSecretsInValue(`${k}:${v}`) ? "[FILTERED]" : v
    }

    const postData = (request["postData"] ?? {}) as Record<string, unknown>
    const rawBody = (postData["text"] as string) ?? ""
    const body = sanitize && rawBody && detectSecretsInValue(rawBody) ? "[FILTERED]" : rawBody

    return {
      method,
      url,
      headers: kvToString(headers),
      body,
      time: (entry["time"] as number) ?? 0,
    }
  }

  const items = entries.map(toPreviewEntry)
  return {
    stats: { totalEntries: entries.length, nodes: entries.length + 2, edges: entries.length + 1 },
    preview: items.slice(0, 10),
    items,
  }
}

// ── OpenAPI ───────────────────────────────────────────────────────────────────

export function parseOpenApiSpec(
  spec: Record<string, unknown>,
  opts: OpenApiParseOptions = {},
): ParsedWorkflow {
  const sanitize = opts.sanitize ?? true
  const paths = (spec["paths"] ?? {}) as Record<string, Record<string, unknown>>
  if (Object.keys(paths).length === 0) throw new Error("OpenAPI spec contains no paths")

  let baseUrl = opts.baseUrl ?? ""
  if (!baseUrl) {
    const servers = (spec["servers"] as { url?: string }[]) ?? []
    if (servers.length > 0 && servers[0]?.url) baseUrl = servers[0].url
    else {
      const host = spec["host"] as string | undefined
      const basePath = (spec["basePath"] as string) ?? ""
      const schemes = (spec["schemes"] as string[]) ?? ["https"]
      if (host) baseUrl = `${schemes[0] ?? "https"}://${host}${basePath}`
    }
  }

  const tagFilter = opts.tagFilter && opts.tagFilter.length > 0 ? new Set(opts.tagFilter) : null

  const start = makeStartNode()
  const httpNodes: HttpRequestNode[] = []

  const methods = ["get", "post", "put", "patch", "delete", "head", "options"] as const
  for (const [path, pathItem] of Object.entries(paths)) {
    for (const method of methods) {
      const operation = pathItem[method] as Record<string, unknown> | undefined
      if (!operation) continue

      const opTags = (operation["tags"] as string[]) ?? []
      if (tagFilter && !opTags.some((t) => tagFilter.has(t))) continue

      const fullUrl = baseUrl ? `${baseUrl}${path}` : path
      const queryParams: Record<string, string> = {}
      const headers: Record<string, string> = {}

      for (const param of ((operation["parameters"] as Record<string, unknown>[]) ?? [])) {
        const name = (param["name"] as string) ?? ""
        const paramIn = (param["in"] as string) ?? ""
        const schema = (param["schema"] as Record<string, unknown>) ?? {}
        const example = schema["example"] !== undefined ? String(schema["example"]) : ""
        if (paramIn === "query") queryParams[name] = example
        else if (paramIn === "header") {
          headers[name] = sanitize && detectSecretsInValue(`${name}:${example}`) ? "[FILTERED]" : example
        }
      }

      let body: string | undefined
      const requestBody = operation["requestBody"] as Record<string, unknown> | undefined
      if (requestBody) {
        const content = (requestBody["content"] as Record<string, Record<string, unknown>>) ?? {}
        if (content["application/json"]) {
          const schema = (content["application/json"]["schema"] as Record<string, unknown>) ?? {}
          const exampleData = generateExampleFromSchema(schema, spec)
          if (exampleData !== null) body = JSON.stringify(exampleData, null, 2)
          headers["Content-Type"] = "application/json"
        }
      }

      const operationId = (operation["operationId"] as string) ?? ""
      const summary = (operation["summary"] as string) ?? ""
      const labelText = operationId || summary || path
      const label = `[${method.toUpperCase()}] ${truncate(labelText, 40)}`
      const pos = positionForIndex(httpNodes.length)

      const normalizedPath = normalizeOpenApiPath(path)
      void normalizedPath

      const config: HttpRequestNode["config"] = {
        method: normalizeMethod(method),
        url: fullUrl,
        headers: kvToPairs(headers),
        queryParams: kvToPairs(queryParams),
        cookies: [],
        timeout: 30,
        followRedirects: true,
        extractors: {},
        ...(body !== undefined ? { body } : {}),
      }

      httpNodes.push({
        nodeId: newId(),
        type: "http-request",
        label,
        position: pos,
        config,
      })
    }
  }

  const end = makeEndNode(httpNodes.length)
  const allNodes: ImportedNode[] = [start, ...httpNodes, end]
  const httpIds = httpNodes.map((n) => n.nodeId)
  const edges = chainEdges(start.nodeId, httpIds, end.nodeId)

  const info = (spec["info"] ?? {}) as Record<string, unknown>
  const apiTitle = (info["title"] as string) ?? "API"
  const now = new Date().toISOString().replace("T", " ").slice(0, 16)
  return {
    name: `Imported from OpenAPI - ${apiTitle} - ${now}`,
    description: `Imported ${httpNodes.length} endpoints from OpenAPI specification`,
    nodes: allNodes,
    edges,
    variables: {},
    tags: ["openapi-import"],
  }
}

export function openApiPreview(
  spec: Record<string, unknown>,
  opts: OpenApiParseOptions = {},
): OpenApiPreviewData {
  const parsed = parseOpenApiSpec(spec, opts)
  const httpNodes = parsed.nodes.filter((n): n is HttpRequestNode => n.type === "http-request")
  const info = (spec["info"] ?? {}) as Record<string, unknown>

  const servers = ((spec["servers"] as { url?: string; description?: string }[]) ?? []).map((s) => ({
    url: s.url ?? "",
    description: s.description ?? "",
  }))

  const tagSet = new Map<string, string>()
  const paths = (spec["paths"] ?? {}) as Record<string, Record<string, unknown>>
  for (const pathItem of Object.values(paths)) {
    for (const method of ["get", "post", "put", "patch", "delete", "head", "options"]) {
      const op = pathItem[method] as Record<string, unknown> | undefined
      if (!op) continue
      for (const tag of ((op["tags"] as string[]) ?? [])) {
        if (!tagSet.has(tag)) tagSet.set(tag, "")
      }
    }
  }
  const availableTags = [...tagSet.entries()].map(([name, description]) => ({ name, description }))

  return {
    nodes: httpNodes,
    availableServers: servers,
    availableTags,
    stats: {
      apiTitle: (info["title"] as string) ?? "API",
      apiVersion: (info["version"] as string) ?? "0.0.0",
      totalEndpoints: httpNodes.length,
    },
    workflow: { nodeCount: parsed.nodes.length },
  }
}

function normalizeOpenApiPath(path: string): string {
  if (!path) return "/"
  let normalized = path.trim()
  if (!normalized.startsWith("/")) normalized = `/${normalized}`
  normalized = normalized.replace(/\/\/+/g, "/")
  return normalized
}

function generateExampleFromSchema(schema: Record<string, unknown>, rootSpec: Record<string, unknown>): unknown {
  if (schema["example"] !== undefined) return schema["example"]
  const ref = schema["$ref"] as string | undefined
  if (ref) {
    const resolved = resolveRef(ref, rootSpec)
    if (resolved) return generateExampleFromSchema(resolved, rootSpec)
    return null
  }
  const type = schema["type"] as string | undefined
  if (type === "object") {
    const props = (schema["properties"] as Record<string, Record<string, unknown>>) ?? {}
    const result: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(props)) {
      const example = generateExampleFromSchema(v, rootSpec)
      if (example !== null) result[k] = example
    }
    return result
  }
  if (type === "array") {
    const items = schema["items"] as Record<string, unknown> | undefined
    if (items) {
      const example = generateExampleFromSchema(items, rootSpec)
      return example !== null ? [example] : []
    }
    return []
  }
  if (type === "string") return "string"
  if (type === "integer" || type === "number") return 0
  if (type === "boolean") return false
  return null
}

function resolveRef(ref: string, root: Record<string, unknown>): Record<string, unknown> | null {
  if (!ref.startsWith("#/")) return null
  const parts = ref.slice(2).split("/")
  let current: unknown = root
  for (const part of parts) {
    if (typeof current !== "object" || current === null) return null
    current = (current as Record<string, unknown>)[part]
  }
  return typeof current === "object" && current !== null ? (current as Record<string, unknown>) : null
}

// ── YAML / JSON parsing ──────────────────────────────────────────────────────

export function parseSpecText(text: string): Record<string, unknown> {
  const trimmed = text.trim()
  if (trimmed.startsWith("{")) {
    return JSON.parse(trimmed) as Record<string, unknown>
  }
  const parsed = parseYaml(trimmed)
  if (typeof parsed !== "object" || parsed === null) throw new Error("Invalid spec format")
  return parsed as Record<string, unknown>
}

function safeUrl(url: string): URL | null {
  try { return new URL(url) } catch { return null }
}

// ── Swagger UI discovery ──────────────────────────────────────────────────────

export function extractSwaggerSpecUrls(html: string, baseUrl: string): readonly string[] {
  const urls: string[] = []
  const seen = new Set<string>()

  const addUrl = (candidate: string) => {
    if (!candidate) return
    let resolved: string
    try {
      resolved = new URL(candidate, baseUrl).toString()
    } catch { return }
    if (!seen.has(resolved)) {
      seen.add(resolved)
      urls.push(resolved)
    }
  }

  const configUrlMatch = html.match(/configUrl\s*[:=]\s*["']([^"']+)["']/)
  if (configUrlMatch?.[1]) addUrl(configUrlMatch[1])

  const urlMatch = html.match(/\burl\s*[:=]\s*["']([^"']+)["']/)
  if (urlMatch?.[1]) addUrl(urlMatch[1])

  const urlsArrayMatch = html.match(/urls\s*[:=]\s*\[([^\]]+)\]/s)
  if (urlsArrayMatch?.[1]) {
    for (const m of urlsArrayMatch[1].matchAll(/["']?url["']?\s*:\s*["']([^"']+)["']/g)) {
      if (m[1]) addUrl(m[1])
    }
  }

  for (const m of html.matchAll(/href\s*=\s*["']([^"']*(?:swagger|openapi)[^"']*\.(?:json|yaml|yml))["']/gi)) {
    if (m[1]) addUrl(m[1])
  }
  for (const m of html.matchAll(/src\s*=\s*["']([^"']*(?:swagger|openapi)[^"']*\.(?:json|yaml|yml))["']/gi)) {
    if (m[1]) addUrl(m[1])
  }

  return urls
}
