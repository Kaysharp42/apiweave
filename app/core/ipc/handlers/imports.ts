import { z } from "zod"
import { WorkflowSchema, KeyValuePairSchema, JsonValueSchema, OpenApiNodeMetaSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import { AppError, ValidationError } from "../errors"
import { WorkflowBundleSchema } from "../../services/import_service"
import type {
  CurlParseOptions,
  HarParseOptions,
  ImportedEdge,
  ImportedNode,
  OpenApiPreviewData,
  ParsedWorkflow,
} from "../../services/import_parsers"

const ws = z.string().min(1)

/**
 * Largest spec/WSDL text the import handlers accept, in characters — the same
 * 10 MiB budget remote spec fetches cap (`MAX_REMOTE_SPEC_BYTES` in
 * import_service): large enough for any real single-file spec, small enough
 * that a pasted document cannot pin the main process building example bodies.
 * Bump only if real specs need more.
 */
const MAX_SPEC_TEXT_CHARS = 10 * 1024 * 1024

const WorkflowImportResultSchema = z
  .object({
    workflowId: z.string(),
    name: z.string(),
    nodeCount: z.number(),
    edgeCount: z.number(),
    secretReferences: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict()

const WorkflowDryRunResultSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    stats: z
      .object({
        nodes: z.number(),
        edges: z.number(),
        variables: z.number(),
        secretReferences: z.number(),
      })
      .strict(),
  })
  .strict()

const ImportedNodeSchema: z.ZodType<ImportedNode> = z.discriminatedUnion("type", [
  z.object({
    nodeId: z.string(),
    type: z.literal("start"),
    label: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    config: z.object({}).strict(),
  }).strict(),
  z.object({
    nodeId: z.string(),
    type: z.literal("http-request"),
    label: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    config: z.object({
      method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"]),
      url: z.string(),
      headers: z.array(KeyValuePairSchema),
      queryParams: z.array(KeyValuePairSchema),
      cookies: z.array(KeyValuePairSchema),
      body: z.string().optional(),
      bodyType: z.literal("soap").optional(),
      soap: z.object({
        version: z.enum(["1.1", "1.2"]),
        action: z.string().optional().describe("The operation's SOAP action."),
        envelope: z.string(),
      }).strict().optional(),
      timeout: z.number(),
      followRedirects: z.boolean(),
      extractors: z.record(z.string(), z.string()),
      openapiMeta: OpenApiNodeMetaSchema.optional(),
      responseSchemas: z.record(z.string(), JsonValueSchema).optional(),
    }).strict(),
  }).strict(),
  z.object({
    nodeId: z.string(),
    type: z.literal("end"),
    label: z.string(),
    position: z.object({ x: z.number(), y: z.number() }),
    config: z.object({}).strict(),
  }).strict(),
])

const ImportedEdgeSchema: z.ZodType<ImportedEdge> = z.object({
  edgeId: z.string(),
  source: z.string(),
  target: z.string(),
  label: z.null(),
}).strict()

/**
 * What the parse-only importers return: a workflow-shaped template bundle,
 * never a saved workflow. The renderer previews it in the import dialog; an
 * agent passes `nodes`/`edges` on to `workflows.create` / `workflows.patch`.
 */
const ParsedWorkflowSchema: z.ZodType<ParsedWorkflow> = z.object({
  name: z.string(),
  description: z.string(),
  nodes: z.array(ImportedNodeSchema),
  edges: z.array(ImportedEdgeSchema),
  // The parsers seed no variables; a never-valued record accepts only `{}`.
  variables: z.record(z.string(), z.never()),
  tags: z.array(z.string()),
}).strict()

/**
 * `workflows.importOpenapi` with `dryRun: true`: the import dialog's preview —
 * the http nodes plus the servers/tags its pickers offer, no start/end/edges.
 * The MCP tool omits `dryRun` from its advertised input and returns only the
 * template bundle; the renderer keeps this shape.
 */
const OpenApiPreviewDataSchema: z.ZodType<OpenApiPreviewData> = z.object({
  nodes: z.array(ImportedNodeSchema),
  availableServers: z.array(z.object({ url: z.string(), description: z.string() }).strict()),
  availableTags: z.array(z.object({ name: z.string(), description: z.string() }).strict()),
  stats: z.object({
    apiTitle: z.string(),
    apiVersion: z.string(),
    totalEndpoints: z.number(),
    definitionCount: z.number().optional(),
    failedDefinitionCount: z.number().optional(),
  }).strict(),
  workflow: z.object({ nodeCount: z.number() }).strict(),
  warnings: z.array(z.string()).optional(),
}).strict()

/**
 * A spec/WSDL that does not parse is the caller's input being wrong, not an
 * internal bug. The parsers throw plain `Error`s, which the router re-throws
 * as HTTP-500-equivalents — over MCP that surfaces as a bare "internal error"
 * naming nothing. Re-label them so both transports answer a validation error
 * carrying the parser's own message.
 */
function parseOrValidationError<T>(parse: () => T): T {
  try {
    return parse()
  } catch (error) {
    if (error instanceof AppError) throw error
    throw new ValidationError(error instanceof Error ? error.message : String(error))
  }
}

function buildOpenApiOpts(i: { baseUrl?: string; tagFilter?: string[]; sanitize?: boolean; schemaAssertions?: boolean }) {
  const opts: { baseUrl?: string; tagFilter?: readonly string[]; sanitize?: boolean; schemaAssertions?: boolean } = {}
  if (i.baseUrl !== undefined) opts["baseUrl"] = i.baseUrl
  if (i.tagFilter !== undefined) opts["tagFilter"] = i.tagFilter
  if (i.sanitize !== undefined) opts["sanitize"] = i.sanitize
  if (i.schemaAssertions !== undefined) opts["schemaAssertions"] = i.schemaAssertions
  return opts
}

function buildHarOpts(i: { importMode?: "linear" | "grouped"; sanitize?: boolean }): HarParseOptions {
  const opts: { importMode?: "linear" | "grouped"; sanitize?: boolean } = {}
  if (i.importMode !== undefined) opts.importMode = i.importMode
  if (i.sanitize !== undefined) opts.sanitize = i.sanitize
  return opts
}

type CurlImportHandlerOptions = { sanitize?: boolean; workflowId?: string; collectionId?: string }

function buildCurlOpts(i: { sanitize?: boolean; workflowId?: string; collectionId?: string }): CurlParseOptions & { readonly workflowId?: string; readonly collectionId?: string } {
  const opts: CurlImportHandlerOptions = {}
  if (i.sanitize !== undefined) opts.sanitize = i.sanitize
  if (i.workflowId !== undefined) opts.workflowId = i.workflowId
  if (i.collectionId !== undefined) opts.collectionId = i.collectionId
  return opts
}

export function registerImportHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { imports } = deps

  router.register("workflows", "export", {
    input: z.object({
      workspaceId: ws,
      workflowId: z.string().min(1),
      includeEnvironment: z.boolean().optional(),
    }).strict(),
    output: z.unknown(),
    handle: (i) => imports.exportWorkflow(i.workspaceId, i.workflowId, i.includeEnvironment ?? true),
  })

  router.register("workflows", "import", {
    input: z.object({
      workspaceId: ws,
      bundle: WorkflowBundleSchema,
      createMissingEnvironments: z.boolean().optional(),
      sanitize: z.boolean().optional(),
      /** The project the imported workflow joins, in the same write. */
      collectionId: z.string().min(1).optional(),
    }).strict(),
    output: WorkflowImportResultSchema,
    handle: (i) => imports.importWorkflow(
      i.workspaceId,
      i.bundle,
      i.createMissingEnvironments ?? false,
      i.sanitize ?? true,
      i.collectionId,
    ),
  })

  router.register("workflows", "dryRun", {
    input: z.object({
      workspaceId: ws,
      bundle: WorkflowBundleSchema,
    }).strict(),
    output: WorkflowDryRunResultSchema,
    handle: (i) => imports.dryRunWorkflow(i.workspaceId, i.bundle),
  })

  router.register("workflows", "importOpenapi", {
    input: z.object({
      workspaceId: ws,
      spec: z.string().min(1).max(MAX_SPEC_TEXT_CHARS),
      baseUrl: z.string().optional(),
      tagFilter: z.array(z.string()).optional(),
      sanitize: z.boolean().optional(),
      /** Attach each operation's response body schemas to its node (default true). */
      schemaAssertions: z.boolean().optional(),
      /** The import dialog's preview shape instead of the template bundle. */
      dryRun: z.boolean().optional(),
    }).strict(),
    output: z.union([ParsedWorkflowSchema, OpenApiPreviewDataSchema]),
    handle: async (i) => {
      await deps.workspaces.get(i.workspaceId)
      const opts = buildOpenApiOpts(i)
      if (i.dryRun) return parseOrValidationError(() => imports.previewOpenApi(i.spec, opts))
      return parseOrValidationError(() => imports.parseOpenApi(i.spec, opts))
    },
  })

  router.register("workflows", "importOpenapiUrl", {
    input: z.object({
      workspaceId: ws,
      url: z.string().min(1),
      baseUrl: z.string().optional(),
      tagFilter: z.array(z.string()).optional(),
      sanitize: z.boolean().optional(),
      schemaAssertions: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    }).strict(),
    output: z.unknown(),
    handle: async (i) => {
      await deps.workspaces.get(i.workspaceId)
      const opts = { url: i.url, ...buildOpenApiOpts(i) }
      if (i.dryRun) return await imports.fetchRemoteOpenApiPreview(opts)
      return await imports.fetchRemoteOpenApi(opts)
    },
  })

  router.register("workflows", "importHar", {
    input: z.object({
      workspaceId: ws,
      data: z.record(z.string(), z.unknown()),
      importMode: z.enum(["linear", "grouped"]).optional(),
      sanitize: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    }).strict(),
    output: z.unknown(),
    handle: async (i) => {
      await deps.workspaces.get(i.workspaceId)
      const opts = buildHarOpts(i)
      if (i.dryRun) return imports.dryRunHar(i.data, opts)
      return imports.parseHar(i.data, opts)
    },
  })

  router.register("workflows", "importCurl", {
    input: z.object({
      workspaceId: ws,
      curlCommand: z.string().min(1),
      sanitize: z.boolean().optional(),
      dryRun: z.boolean().optional(),
      // Return the parsed nodes without writing anything, like importHar/importOpenapi.
      parseOnly: z.boolean().optional(),
      workflowId: z.string().optional(),
      collectionId: z.string().optional(),
    }).strict(),
    output: z.unknown(),
    handle: async (i) => {
      const sanitizeOpts = buildCurlOpts(i)
      if (i.dryRun) {
        return imports.dryRunCurl(i.curlCommand, sanitizeOpts)
      }
      if (i.parseOnly) {
        await deps.workspaces.get(i.workspaceId)
        return imports.parseCurl(i.curlCommand, sanitizeOpts)
      }
      return await imports.importCurlAsWorkflow(i.workspaceId, i.curlCommand, sanitizeOpts)
    },
  })

  router.register("workflows", "importWsdl", {
    input: z.object({
      workspaceId: ws,
      wsdlText: z.string().min(1).max(MAX_SPEC_TEXT_CHARS),
      endpointUrl: z.string().optional(),
      forceHttps: z.boolean().optional(),
    }).strict(),
    output: ParsedWorkflowSchema,
    handle: async (i) => {
      await deps.workspaces.get(i.workspaceId)
      return parseOrValidationError(() => imports.parseWsdl(i.wsdlText, {
        ...(i.endpointUrl === undefined ? {} : { endpointUrl: i.endpointUrl }),
        ...(i.forceHttps === undefined ? {} : { forceHttps: i.forceHttps }),
      }))
    },
  })

  router.register("workflows", "saveTemplates", {
    input: z.object({
      workspaceId: ws,
      workflowId: z.string().min(1),
      templates: z.array(ImportedNodeSchema),
    }).strict(),
    output: WorkflowSchema,
    handle: (i) => imports.saveTemplates(i.workspaceId, i.workflowId, i.templates),
  })
}
