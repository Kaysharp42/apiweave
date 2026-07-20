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
  sanitizeVariablesForExport,
  type SecretReference,
} from "./secret_utils"
import { SafeHttp } from "../runner/safe_http"
import { canonicalizeWorkflowGraph } from "../repositories/helpers"
import {
  parseCurlCommands,
  parseHarData,
  parseOpenApiSpec,
  parseSpecText,
  openApiPreview,
  harDryRun,
  extractSwaggerSpecUrls,
  type ParsedWorkflow,
  type ImportedNode,
  type HttpRequestNode,
  type OpenApiParseOptions,
  type HarParseOptions,
  type CurlParseOptions,
  type HarDryRunResult,
  type CurlDryRunResult,
  type OpenApiPreviewData,
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
        plain["config"] = sanitizeVariablesForExport(plain["config"] as Record<string, JsonValue>)
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
            plain["config"] = sanitizeVariablesForExport(plain["config"] as Record<string, JsonValue>)
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
    const { spec } = await this.discoverAndFetchSpec(opts.url)
    const parseOpts = buildParseOpts(opts)
    return parseOpenApiSpec(spec, parseOpts)
  }

  async fetchRemoteOpenApiPreview(opts: RemoteOpenApiOptions): Promise<OpenApiPreviewData> {
    const { spec } = await this.discoverAndFetchSpec(opts.url)
    const parseOpts = buildParseOpts(opts)
    return openApiPreview(spec, parseOpts)
  }

  private async discoverAndFetchSpec(url: string): Promise<{ spec: Record<string, unknown>; sourceUrl: string; warnings: string[] }> {
    this.safeHttp.validateUrl(url)
    const warnings: string[] = []

    const response = await this.safeHttp.safeGet(url)
    if (!response.ok) throw new ValidationError(`Failed to fetch URL: HTTP ${response.status}`)

    const contentType = response.headers.get("content-type")?.toLowerCase() ?? ""
    const text = await response.text()

    if (isJsonSpec(text, contentType)) {
      const spec = parseSpecText(text)
      if (spec["paths"] !== undefined) return { spec, sourceUrl: url, warnings }
    }

    if (isYamlSpec(text, contentType)) {
      const spec = parseSpecText(text)
      if (spec["paths"] !== undefined) return { spec, sourceUrl: url, warnings }
    }

    const candidates = extractSwaggerSpecUrls(text, url)
    if (candidates.length === 0) {
      throw new ValidationError("No OpenAPI/Swagger spec found at URL and no spec URLs discovered in HTML")
    }

    for (const candidate of candidates) {
      try {
        this.safeHttp.validateUrl(candidate)
        const specResponse = await this.safeHttp.safeGet(candidate)
        if (!specResponse.ok) {
          warnings.push(`Failed to fetch candidate ${candidate}: HTTP ${specResponse.status}`)
          continue
        }
        const specText = await specResponse.text()
        const spec = parseSpecText(specText)
        if (spec["paths"] !== undefined) return { spec, sourceUrl: candidate, warnings }
        warnings.push(`Candidate ${candidate} did not contain paths`)
      } catch (e) {
        warnings.push(`Candidate ${candidate} failed: ${e instanceof Error ? e.message : String(e)}`)
      }
    }

    throw new ValidationError(`No valid OpenAPI spec found among ${candidates.length} candidate(s)`)
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

function isJsonSpec(text: string, contentType: string): boolean {
  if (contentType.includes("json")) return true
  const trimmed = text.trim()
  return trimmed.startsWith("{") || trimmed.startsWith("[")
}

function isYamlSpec(text: string, contentType: string): boolean {
  if (contentType.includes("yaml") || contentType.includes("yml")) return true
  const trimmed = text.trimStart()
  return trimmed.startsWith("openapi:") || trimmed.startsWith("swagger:")
}
