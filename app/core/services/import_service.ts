import type { Workflow } from "@shared/types/Workflow"
import type { JsonValue } from "@shared/types/JsonValue"
import type { WorkflowEdge } from "@shared/types/WorkflowEdge"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import { WorkflowEdgeSchema } from "@shared/zod-schemas/WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "@shared/zod-schemas/WorkflowNodeSchema"
import type {
  CollectionRepository,
  EnvironmentRepository,
  WorkflowCreate,
  WorkflowRepository,
} from "../repositories"
import type { PermissionProvider } from "../auth/PermissionProvider"
import type { SyncProvider } from "../sync/SyncProvider"
import { recordEnvironmentUpsert, recordWorkflowUpsert } from "../sync/cloud-mutations"
import { NotFoundError, ValidationError } from "../ipc/errors"
import { RESOURCE_WORKFLOWS } from "../auth/permissions"
import { authorizeWorkspace } from "./authorize"
import type { ScopeResolver } from "./scope_resolver"
import {
  assertNoSecretValues,
  collectSecretRefs,
  isSecretKey,
  sanitizeExportValue,
  sanitizeVariablesForExport,
  type SecretReference,
} from "./secret_utils"
import { SafeHttp } from "../runner/safe_http"

// ponytail: fixed 10 MiB knob for remote OpenAPI/Swagger doc fetches — large
// enough for real specs, small enough that a malicious/slow URL can't exhaust
// main-process memory or hang the refresh. Bump only if real specs need more.
const MAX_REMOTE_SPEC_BYTES = 10 * 1024 * 1024
// ponytail: fixed discovery budget — a Swagger UI needs a handful of hops to
// reach its swagger-config; more than that means we are guessing.
const MAX_DISCOVERY_FETCHES = 16
const MAX_SPEC_DEFINITIONS = 50
const DEFINITION_FETCH_CONCURRENCY = 6
import { canonicalizeWorkflowGraph } from "../repositories/helpers"
import {
  parseCurlCommands,
  parseHarData,
  parseOpenApiSpec,
  parseSpecText,
  openApiPreview,
  harDryRun,
  extractSwaggerHints,
  definitionsFromSwaggerConfig,
  definitionScope,
  mergeParsedWorkflows,
  mergeOpenApiPreviews,
  type ParsedWorkflow,
  type ImportedNode,
  type HttpRequestNode,
  type OpenApiParseOptions,
  type HarParseOptions,
  type CurlParseOptions,
  type HarDryRunResult,
  type CurlDryRunResult,
  type OpenApiPreviewData,
  type OpenApiDefinition,
} from "./import_parsers"

export interface ExportedEnvironment {
  readonly environmentId: string
  readonly name: string
  readonly description?: string | null | undefined
  readonly variables: Record<string, JsonValue>
  readonly swaggerDocUrl?: string | null | undefined
}

export interface WorkflowBundle {
  readonly workflow: {
    readonly workflowId?: string | undefined
    readonly name: string
    readonly description?: string | undefined
    readonly nodes: readonly JsonValue[]
    readonly edges: readonly JsonValue[]
    readonly variables: Record<string, JsonValue>
    readonly tags?: readonly string[] | undefined
    readonly environmentId?: string | null | undefined
    readonly selectedEnvironmentId?: string | null | undefined
  }
  readonly environments?: readonly ExportedEnvironment[] | undefined
  readonly secretReferences?: readonly (SecretReference | string)[] | undefined
  readonly metadata?: {
    readonly exportedAt: string
    readonly workflowCount?: number | undefined
    readonly environmentCount?: number | undefined
    readonly secretReferenceCount?: number | undefined
  } | undefined
}

export interface WorkflowImportResult {
  readonly workflowId: string
  readonly name: string
  readonly nodeCount: number
  readonly edgeCount: number
  readonly secretReferences: readonly string[]
  readonly warnings: readonly string[]
}

export interface WorkflowDryRunResult {
  readonly valid: boolean
  readonly errors: readonly string[]
  readonly warnings: readonly string[]
  readonly stats: {
    readonly nodes: number
    readonly edges: number
    readonly variables: number
    readonly secretReferences: number
  }
}

export interface RemoteOpenApiOptions {
  readonly url: string
  readonly baseUrl?: string
  readonly tagFilter?: readonly string[]
  readonly sanitize?: boolean
}

export class ImportService {
  private readonly safeHttp: SafeHttp

  constructor(
    private readonly workflows: WorkflowRepository,
    private readonly environments: EnvironmentRepository,
    private readonly collections: CollectionRepository,
    private readonly syncProvider: SyncProvider,
    private readonly permissions: PermissionProvider,
    private readonly scopeResolver: ScopeResolver,
    safeHttp?: SafeHttp,
  ) {
    this.safeHttp = safeHttp ?? new SafeHttp()
  }

  async exportWorkflow(
    workspaceId: string,
    workflowId: string,
    includeEnvironment: boolean,
  ): Promise<WorkflowBundle> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "read", RESOURCE_WORKFLOWS)
    const workflow = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
    if (!workflow) throw new NotFoundError(`workflow ${workflowId} not found`)

    const rawVariables = JSON.parse(JSON.stringify(workflow.variables ?? {})) as Record<string, JsonValue>
    const sanitizedVars = sanitizeVariablesForExport(rawVariables)

    const nodes = workflow.nodes.map((node) => {
      const plain = JSON.parse(JSON.stringify(node)) as Record<string, JsonValue>
      if (plain["config"] !== undefined && typeof plain["config"] === "object" && plain["config"] !== null) {
        plain["config"] = sanitizeExportValue(plain["config"])
      }
      return plain as JsonValue
    })

    const secretRefs: SecretReference[] = []
    const seen = new Set<string>()
    collectSecretRefs(rawVariables, "workspace", workspaceId, secretRefs, seen)
    for (const node of workflow.nodes) {
      const plain = JSON.parse(JSON.stringify(node)) as JsonValue
      collectSecretRefs(plain, "workspace", workspaceId, secretRefs, seen)
    }

    const envList: ExportedEnvironment[] = []
    const envId = workflow.selectedEnvironmentId ?? null
    if (includeEnvironment && envId) {
      const env = this.environments.getById(envId)
      if (env && env.workspaceId === workspaceId) {
        const rawEnvVars = JSON.parse(JSON.stringify(env.variables ?? {})) as Record<string, JsonValue>
        for (const [key, value] of Object.entries(rawEnvVars)) {
          if (isSecretKey(key) && typeof value === "string") {
            const dedupeKey = `${key} workspace ${workspaceId}`
            if (!seen.has(dedupeKey)) {
              seen.add(dedupeKey)
              secretRefs.push({ name: key, scopeType: "workspace", scopeId: workspaceId })
            }
          }
        }
        envList.push({
          environmentId: env.environmentId,
          name: env.name,
          description: env.description ?? null,
          variables: sanitizeVariablesForExport(rawEnvVars),
          swaggerDocUrl: env.swaggerDocUrl ?? null,
        })
      }
    }

    const bundle: WorkflowBundle = {
      workflow: {
        workflowId: workflow.workflowId,
        name: workflow.name,
        description: workflow.description ?? "",
        nodes,
        edges: workflow.edges.map((e) => JSON.parse(JSON.stringify(e)) as JsonValue),
        variables: sanitizedVars,
        tags: workflow.tags,
        selectedEnvironmentId: envId,
      },
      environments: envList,
      secretReferences: secretRefs,
      metadata: {
        exportedAt: new Date().toISOString(),
        workflowCount: 1,
        environmentCount: envList.length,
        secretReferenceCount: secretRefs.length,
      },
    }

    assertNoSecretValues(toJsonValue(bundle))
    return bundle
  }

  async importWorkflow(
    targetWorkspaceId: string,
    bundle: WorkflowBundle,
    createMissingEnvironments: boolean,
    sanitize: boolean,
  ): Promise<WorkflowImportResult> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, targetWorkspaceId, "create", RESOURCE_WORKFLOWS)
    validateWorkflowBundle(bundle)

    const warnings: string[] = []
    const secretRefs: string[] = []

    const allData = JSON.parse(JSON.stringify(bundle)) as JsonValue
    const refs: SecretReference[] = []
    const seen = new Set<string>()
    collectSecretRefs(allData, "workspace", targetWorkspaceId, refs, seen)
    for (const ref of refs) secretRefs.push(ref.name)

    let mappedEnvId: string | null = null
    const bundledEnvs = bundle.environments ?? []
    const wfEnvId = bundle.workflow.selectedEnvironmentId ?? bundle.workflow.environmentId ?? null

    if (wfEnvId && bundledEnvs.length > 0) {
      const bundledEnv = bundledEnvs.find((e) => e.environmentId === wfEnvId) ?? bundledEnvs[0]
      if (bundledEnv && createMissingEnvironments) {
        const vars = sanitize
          ? sanitizeVariablesForExport(bundledEnv.variables as Record<string, JsonValue>)
          : (bundledEnv.variables as Record<string, JsonValue>)
        const created = this.environments.create({
          workspaceId: targetWorkspaceId,
          name: bundledEnv.name,
          description: bundledEnv.description ?? null,
          swaggerDocUrl: bundledEnv.swaggerDocUrl ?? null,
          variables: vars,
          secrets: {},
        })
        recordEnvironmentUpsert(this.syncProvider, created)
        mappedEnvId = created.environmentId
      }
    }

    const rawNodes = sanitize
      ? bundle.workflow.nodes.map((n) => {
          const plain = JSON.parse(JSON.stringify(n)) as Record<string, JsonValue>
          if (plain["config"] !== undefined && typeof plain["config"] === "object" && plain["config"] !== null) {
            plain["config"] = sanitizeExportValue(plain["config"])
          }
          return plain as JsonValue
        })
      : bundle.workflow.nodes

    const wfVars = sanitize
      ? sanitizeVariablesForExport((bundle.workflow.variables ?? {}) as Record<string, JsonValue>)
      : ((bundle.workflow.variables ?? {}) as Record<string, JsonValue>)

    const create: WorkflowCreate = {
      workspaceId: targetWorkspaceId,
      name: bundle.workflow.name || "Imported Workflow",
      description: bundle.workflow.description ?? null,
      nodes: parseWorkflowNodes(rawNodes),
      edges: parseWorkflowEdges(bundle.workflow.edges ?? []),
      variables: wfVars as Record<string, JsonValue>,
      tags: [...(bundle.workflow.tags ?? [])],
      selectedEnvironmentId: mappedEnvId,
    }

    const created = this.workflows.create(create)
    recordWorkflowUpsert(this.syncProvider, created)
    await this.syncProvider.push()

    return {
      workflowId: created.workflowId,
      name: created.name,
      nodeCount: created.nodes.length,
      edgeCount: created.edges.length,
      secretReferences: [...new Set(secretRefs)],
      warnings,
    }
  }

  async dryRunWorkflow(targetWorkspaceId: string, bundle: WorkflowBundle): Promise<WorkflowDryRunResult> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, targetWorkspaceId, "create", RESOURCE_WORKFLOWS)

    const errors: string[] = []
    const warnings: string[] = []

    try {
      validateWorkflowBundle(bundle)
    } catch (e) {
      errors.push(e instanceof Error ? e.message : String(e))
      return { valid: false, errors, warnings, stats: { nodes: 0, edges: 0, variables: 0, secretReferences: 0 } }
    }

    const nodes = bundle.workflow.nodes ?? []
    const nodeIds = new Set<string>()
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i] as Record<string, unknown>
      const nodeId = node["nodeId"]
      if (typeof nodeId !== "string" || nodeId.length === 0) {
        errors.push(`Node at index ${i} missing 'nodeId'`)
      } else if (nodeIds.has(nodeId)) {
        errors.push(`Duplicate node ID: ${nodeId}`)
      } else {
        nodeIds.add(nodeId)
      }
    }

    const allData = JSON.parse(JSON.stringify(bundle)) as JsonValue
    const refs: SecretReference[] = []
    const seen = new Set<string>()
    collectSecretRefs(allData, "workspace", targetWorkspaceId, refs, seen)

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      stats: {
        nodes: nodes.length,
        edges: (bundle.workflow.edges ?? []).length,
        variables: Object.keys(bundle.workflow.variables ?? {}).length,
        secretReferences: refs.length,
      },
    }
  }

  parseOpenApi(specText: string, opts: OpenApiParseOptions = {}): ParsedWorkflow {
    const spec = parseSpecText(specText)
    return parseOpenApiSpec(spec, opts)
  }

  previewOpenApi(specText: string, opts: OpenApiParseOptions = {}): OpenApiPreviewData {
    const spec = parseSpecText(specText)
    return openApiPreview(spec, opts)
  }

  async fetchRemoteOpenApi(opts: RemoteOpenApiOptions): Promise<ParsedWorkflow> {
    const { definitions, warnings } = await this.discoverDefinitions(opts.url)
    const parts = this.perDefinition(definitions, warnings, opts, (spec, parseOpts) => parseOpenApiSpec(spec, parseOpts))
    return mergeParsedWorkflows(parts.map((p) => ({ name: p.name, workflow: p.value })))
  }

  async fetchRemoteOpenApiPreview(opts: RemoteOpenApiOptions): Promise<OpenApiPreviewData> {
    const { definitions, warnings, discovered } = await this.discoverDefinitions(opts.url)
    const parts = this.perDefinition(definitions, warnings, opts, (spec, parseOpts) => openApiPreview(spec, parseOpts))
    const merged = mergeOpenApiPreviews(parts.map((p) => ({ name: p.name, preview: p.value })))
    return {
      ...merged,
      warnings,
      stats: {
        ...merged.stats,
        definitionCount: parts.length,
        failedDefinitionCount: Math.max(0, discovered - parts.length),
      },
    }
  }

  /** Parse each definition on its own so one unusable spec cannot sink the import. */
  private perDefinition<T>(
    definitions: readonly OpenApiDefinition[],
    warnings: string[],
    opts: RemoteOpenApiOptions,
    parse: (spec: Record<string, unknown>, parseOpts: OpenApiParseOptions) => T,
  ): { name: string; value: T }[] {
    const parts: { name: string; value: T }[] = []
    for (const def of definitions) {
      try {
        parts.push({ name: def.name, value: parse(def.spec, this.defParseOpts(opts, def)) })
      } catch (e) {
        warnings.push(`Definition "${def.name}" skipped: ${e instanceof Error ? e.message : String(e)}`)
      }
    }
    if (parts.length === 0) throw new ValidationError(`No importable OpenAPI definition: ${warnings.join("; ")}`)
    return parts
  }

  private defParseOpts(opts: RemoteOpenApiOptions, def: OpenApiDefinition): OpenApiParseOptions {
    return {
      ...buildParseOpts(opts),
      source: {
        definitionName: def.name,
        definitionSpecUrl: def.specUrl,
        definitionScope: definitionScope(def.name, def.specUrl),
        sourceUiUrl: opts.url,
      },
    }
  }

  /**
   * Resolve a user-supplied URL to one or more OpenAPI specs. The URL may be
   * the spec itself (.json/.yaml or any endpoint returning one), or a Swagger UI
   * page — in which case the definition list is discovered from the page, its
   * initializer script, an explicit/conventional swagger-config endpoint, or the
   * `configUrl`/`url`/`urls.primaryName` query hints Swagger UI puts in its own URL.
   */
  private async discoverDefinitions(url: string): Promise<{ definitions: OpenApiDefinition[]; warnings: string[]; discovered: number }> {
    this.safeHttp.validateUrl(url)
    const warnings: string[] = []

    const root = await this.fetchCapped(url)
    if (!root.ok) throw new ValidationError(`Failed to fetch ${url}: ${root.error}`)

    const directSpec = asSpec(root.text, root.contentType)
    if (directSpec) return { definitions: [{ name: specTitle(directSpec), specUrl: url, spec: directSpec }], warnings, discovered: 1 }

    const targets = await this.discoverSpecTargets(url, root.text, warnings)
    if (targets.length === 0) {
      throw new ValidationError(
        "No OpenAPI/Swagger spec found at URL and no spec URLs discovered. Point at the spec itself (e.g. /v3/api-docs) or a Swagger UI page that exposes its config.",
      )
    }
    if (targets.length > MAX_SPEC_DEFINITIONS) {
      throw new ValidationError(`Discovered ${targets.length} definitions, which exceeds the limit of ${MAX_SPEC_DEFINITIONS}`)
    }

    const definitions: OpenApiDefinition[] = []
    for (let i = 0; i < targets.length; i += DEFINITION_FETCH_CONCURRENCY) {
      const batch = targets.slice(i, i + DEFINITION_FETCH_CONCURRENCY)
      const fetched = await Promise.all(batch.map(async (target) => {
        const res = await this.fetchCapped(target.specUrl)
        if (!res.ok) return `Failed to fetch definition "${target.name}" (${target.specUrl}): ${res.error}`
        const spec = asSpec(res.text, res.contentType)
        if (!spec) return `Definition "${target.name}" (${target.specUrl}) is not an OpenAPI document`
        return { name: target.name, specUrl: target.specUrl, spec }
      }))
      for (const result of fetched) {
        if (typeof result === "string") warnings.push(result)
        else definitions.push(result)
      }
    }

    if (definitions.length === 0) {
      throw new ValidationError(`No valid OpenAPI spec found among ${targets.length} candidate(s): ${warnings.join("; ")}`)
    }
    return { definitions, warnings, discovered: targets.length }
  }

  /** Walk Swagger UI's config chain (page → scripts/config endpoints) to the spec URLs. */
  private async discoverSpecTargets(
    uiUrl: string,
    html: string,
    warnings: string[],
  ): Promise<{ name: string; specUrl: string }[]> {
    const query = new URL(uiUrl).searchParams
    let primaryName = query.get("urls.primaryName")?.trim() ?? ""

    const targets: { name: string; specUrl: string }[] = []
    const seenTarget = new Set<string>()
    const addTarget = (name: string, specUrl: string) => {
      if (seenTarget.has(specUrl)) return
      seenTarget.add(specUrl)
      targets.push({ name: name || specUrl, specUrl })
    }

    const queryUrl = query.get("url")?.trim()
    if (queryUrl) addTarget(primaryName || "Default", new URL(queryUrl, uiUrl).toString())

    const hints = extractSwaggerHints(html, uiUrl)
    for (const def of hints.definitions) addTarget(def.name, def.specUrl)

    // Cheap targeted JSON first, page scripts last: the stock swagger-initializer.js
    // carries a petstore.swagger.io placeholder `url` that must never win over the
    // real swagger-config.
    const pending: string[] = []
    const queryConfig = query.get("configUrl")?.trim()
    if (queryConfig) pending.push(new URL(queryConfig, uiUrl).toString())
    pending.push(...hints.configUrls, ...conventionalConfigUrls(uiUrl), ...hints.scriptUrls)
    const fallbackSpecUrls = [...hints.specUrls]

    const seenFetch = new Set<string>([uiUrl])
    let fetches = 0
    while (pending.length > 0 && fetches < MAX_DISCOVERY_FETCHES) {
      const candidate = pending.shift()!
      if (seenFetch.has(candidate)) continue
      seenFetch.add(candidate)
      fetches++

      const res = await this.fetchCapped(candidate)
      if (!res.ok) continue

      const spec = asSpec(res.text, res.contentType)
      if (spec) {
        addTarget(specTitle(spec), candidate)
        break
      }

      const json = tryParseJson(res.text)
      if (json) {
        const defs = definitionsFromSwaggerConfig(json, candidate)
        if (defs.length > 0) {
          const configPrimary = json["urls.primaryName"]
          if (!primaryName && typeof configPrimary === "string") primaryName = configPrimary.trim()
          for (const def of defs) addTarget(def.name, def.specUrl)
          break
        }
        continue
      }

      // HTML/JS: mine it for the next hop (initializer scripts, nested configs).
      const sub = extractSwaggerHints(res.text, candidate)
      pending.unshift(...sub.configUrls)
      for (const def of sub.definitions) addTarget(def.name, def.specUrl)
      fallbackSpecUrls.push(...sub.specUrls)
    }

    if (targets.length === 0) {
      for (const specUrl of fallbackSpecUrls) addTarget(specUrl, specUrl)
      if (targets.length > 0) warnings.push("No swagger-config found; falling back to spec URLs found in the page")
    }

    if (primaryName) {
      const selected = targets.filter((t) => t.name.trim().toLowerCase() === primaryName.toLowerCase())
      if (selected.length > 0) return selected
    }
    return targets
  }

  private async fetchCapped(url: string): Promise<FetchedText> {
    try {
      this.safeHttp.validateUrl(url)
      const response = await this.safeHttp.safeGet(url, {
        headers: { Accept: "application/json, application/vnd.oai.openapi+json, application/yaml, text/html, */*" },
      })
      if (!response.ok) {
        await response.body?.cancel()
        return { ok: false, error: `HTTP ${response.status}` }
      }
      const { text, truncated } = await this.safeHttp.readTextCapped(response, MAX_REMOTE_SPEC_BYTES)
      if (truncated) throw new ValidationError(`Response from ${url} exceeds the ${MAX_REMOTE_SPEC_BYTES} byte limit for OpenAPI/Swagger docs`)
      return { ok: true, text, contentType: response.headers.get("content-type")?.toLowerCase() ?? "" }
    } catch (e) {
      if (e instanceof ValidationError) throw e
      return { ok: false, error: e instanceof Error ? e.message : String(e) }
    }
  }

  parseHar(data: Record<string, unknown>, opts: HarParseOptions = {}): ParsedWorkflow {
    return parseHarData(data, opts)
  }

  dryRunHar(data: Record<string, unknown>, opts: HarParseOptions = {}): HarDryRunResult {
    return harDryRun(data, opts)
  }

  parseCurl(input: string, opts: CurlParseOptions = {}): ParsedWorkflow {
    return parseCurlCommands(input, opts)
  }

  dryRunCurl(input: string, opts: CurlParseOptions = {}): CurlDryRunResult {
    const parsed = parseCurlCommands(input, opts)
    const httpNodes = parsed.nodes.filter((n): n is HttpRequestNode => n.type === "http-request")
    return {
      stats: { totalRequests: httpNodes.length },
      workflow: {
        name: parsed.name,
        nodeCount: parsed.nodes.length,
        edgeCount: parsed.edges.length,
      },
    }
  }

  async importCurlAsWorkflow(
    workspaceId: string,
    input: string,
    opts: CurlParseOptions & { readonly workflowId?: string; readonly collectionId?: string } = {},
  ): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "create", RESOURCE_WORKFLOWS)
    const parsed = parseCurlCommands(input, opts)
    const httpNodes = parsed.nodes.filter((n): n is HttpRequestNode => n.type === "http-request")

    if (opts.workflowId) {
      const existing = this.workflows.getByIdInWorkspace(opts.workflowId, workspaceId)
      if (!existing) throw new NotFoundError(`workflow ${opts.workflowId} not found`)

      const existingIds = new Set(existing.nodes.map((n) => n.nodeId))
      const newNodes = httpNodes.filter((n) => !existingIds.has(n.nodeId))
      if (newNodes.length === 0) return existing

      const lastExisting = existing.nodes[existing.nodes.length - 1]
      const baseX = lastExisting ? lastExisting.position.x + X_SPACING : START_X
      const baseY = lastExisting ? lastExisting.position.y : START_Y

      const repositioned = newNodes.map((n, i) => ({
        ...n,
        position: { x: baseX + (i % NODES_PER_ROW) * X_SPACING, y: baseY + Math.floor(i / NODES_PER_ROW) * Y_SPACING },
      }))

      const mergedNodes: WorkflowNode[] = [...existing.nodes, ...repositioned]
      const lastHttpId = repositioned[repositioned.length - 1]?.nodeId ?? lastExisting?.nodeId
      const endNode = existing.nodes.find((n) => n.type === "end")

      const mergedEdges = existing.edges.filter((e) => {
        if (!endNode) return true
        return e.target !== endNode.nodeId
      })
      if (lastExisting && repositioned.length > 0) {
        const firstNew = repositioned[0]!
        mergedEdges.push({ edgeId: `edge_import_${Date.now()}_0`, source: lastExisting.nodeId, target: firstNew.nodeId, label: null })
      }
      for (let i = 0; i < repositioned.length - 1; i++) {
        mergedEdges.push({ edgeId: `edge_import_${Date.now()}_${i + 1}`, source: repositioned[i]!.nodeId, target: repositioned[i + 1]!.nodeId, label: null })
      }
      if (endNode && lastHttpId) {
        mergedEdges.push({ edgeId: `edge_import_${Date.now()}_end`, source: lastHttpId, target: endNode.nodeId, label: null })
      }

      const updated = this.workflows.update(opts.workflowId, { nodes: mergedNodes, edges: mergedEdges })
      if (!updated) throw new NotFoundError(`workflow ${opts.workflowId} not found`)
      recordWorkflowUpsert(this.syncProvider, updated)
      await this.syncProvider.push()
      return updated
    }

    if (opts.collectionId) {
      const collection = this.collections.getById(opts.collectionId)
      if (!collection || collection.workspaceId !== workspaceId) {
        throw new NotFoundError(`collection ${opts.collectionId} not found`)
      }
    }

    const create: WorkflowCreate = {
      workspaceId,
      name: parsed.name,
      description: parsed.description,
      nodes: parseWorkflowNodes(parsed.nodes.map((node) => toJsonValue(node))),
      edges: parseWorkflowEdges(parsed.edges.map((edge) => toJsonValue(edge))),
      variables: {},
      tags: [...parsed.tags],
      ...(opts.collectionId ? { collectionId: opts.collectionId } : {}),
    }
    const created = this.workflows.create(create)
    recordWorkflowUpsert(this.syncProvider, created)
    await this.syncProvider.push()
    return created
  }

  async saveTemplates(
    workspaceId: string,
    workflowId: string,
    templates: readonly ImportedNode[],
  ): Promise<Workflow> {
    await authorizeWorkspace(this.scopeResolver, this.permissions, workspaceId, "update", RESOURCE_WORKFLOWS)
    const existing = this.workflows.getByIdInWorkspace(workflowId, workspaceId)
    if (!existing) throw new NotFoundError(`workflow ${workflowId} not found`)

    const existingTemplates = (existing.nodeTemplates ?? []) as JsonValue[]
    const newTemplates = templates.map((t) => JSON.parse(JSON.stringify(t)) as JsonValue)
    const merged = [...existingTemplates, ...newTemplates]

    const updated = this.workflows.update(workflowId, { nodeTemplates: merged })
    if (!updated) throw new NotFoundError(`workflow ${workflowId} not found`)
    recordWorkflowUpsert(this.syncProvider, updated)
    await this.syncProvider.push()
    return updated
  }
}

const NODES_PER_ROW = 8
const X_SPACING = 400
const Y_SPACING = 200
const START_X = 600
const START_Y = 100

function validateWorkflowBundle(bundle: WorkflowBundle): void {
  if (typeof bundle !== "object" || bundle === null) {
    throw new ValidationError("Bundle must be a JSON object")
  }
  if (!bundle.workflow || typeof bundle.workflow !== "object") {
    throw new ValidationError("Invalid bundle: missing 'workflow' key")
  }
  if (bundle.workflow.nodes === undefined) {
    throw new ValidationError("Invalid bundle: missing 'workflow.nodes' key")
  }
  assertNoSecretValues(toJsonValue(bundle))
}

function toJsonValue(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value)) as JsonValue
}

function parseWorkflowNodes(nodes: readonly JsonValue[]): WorkflowNode[] {
  const graph = canonicalizeWorkflowGraph({ nodes, edges: [] }) as { readonly nodes?: readonly unknown[] }
  return (graph.nodes ?? []).map((node) => WorkflowNodeSchema.parse(node))
}

function parseWorkflowEdges(edges: readonly JsonValue[]): WorkflowEdge[] {
  return edges.map((edge) => WorkflowEdgeSchema.parse(edge))
}

function buildParseOpts(opts: RemoteOpenApiOptions): OpenApiParseOptions {
  const result: Record<string, unknown> = {}
  if (opts.baseUrl !== undefined) result["baseUrl"] = opts.baseUrl
  if (opts.tagFilter !== undefined) result["tagFilter"] = opts.tagFilter
  if (opts.sanitize !== undefined) result["sanitize"] = opts.sanitize
  return result as OpenApiParseOptions
}

type FetchedText =
  | { readonly ok: true; readonly text: string; readonly contentType: string }
  | { readonly ok: false; readonly error: string }

function tryParseJson(text: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  if (!trimmed.startsWith("{")) return null
  try {
    const parsed = JSON.parse(trimmed) as unknown
    return typeof parsed === "object" && parsed !== null ? (parsed as Record<string, unknown>) : null
  } catch {
    return null
  }
}

/** The document if it is an OpenAPI/Swagger spec (JSON or YAML), else null. */
function asSpec(text: string, contentType: string): Record<string, unknown> | null {
  const trimmed = text.trim()
  const looksJson = contentType.includes("json") || trimmed.startsWith("{")
  const looksYaml =
    contentType.includes("yaml") || contentType.includes("yml") ||
    trimmed.startsWith("openapi:") || trimmed.startsWith("swagger:")
  if (!looksJson && !looksYaml) return null
  try {
    const spec = parseSpecText(trimmed)
    return spec["paths"] !== undefined ? spec : null
  } catch {
    return null
  }
}

function specTitle(spec: Record<string, unknown>): string {
  const info = (spec["info"] ?? {}) as Record<string, unknown>
  return typeof info["title"] === "string" && info["title"].trim() ? info["title"].trim() : "Default"
}

/**
 * Where springdoc/swagger-ui setups conventionally serve swagger-config when the
 * page does not say (springdoc puts it at <context>/v3/api-docs/swagger-config,
 * which is not under the /webjars/swagger-ui/ path the user pastes).
 */
function conventionalConfigUrls(uiUrl: string): string[] {
  const parsed = new URL(uiUrl)
  const origin = parsed.origin
  const path = parsed.pathname || "/"
  const directory = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : ""

  const prefixes = new Set<string>([""])
  for (const marker of ["/webjars/swagger-ui/", "/swagger-ui/", "/webjars/"]) {
    if (path.includes(marker)) prefixes.add(path.slice(0, path.indexOf(marker)))
  }

  const out: string[] = []
  const push = (candidate: string) => {
    const resolved = new URL(candidate, origin).toString()
    if (!out.includes(resolved)) out.push(resolved)
  }
  if (directory) push(`${directory}/swagger-config`)
  for (const prefix of prefixes) {
    const base = prefix.replace(/\/$/, "")
    for (const suffix of [
      "/v3/api-docs/swagger-config",
      "/api-docs/swagger-config",
      "/swagger/v3/api-docs/swagger-config",
      "/swagger/v1/swagger-config",
      "/swagger/swagger-config",
    ]) push(`${base}${suffix}`)
  }
  return out
}
