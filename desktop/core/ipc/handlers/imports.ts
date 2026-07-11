import { z } from "zod"
import { WorkflowSchema, JsonValueSchema, KeyValuePairSchema } from "../../../../shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { HandlerDeps } from "./common"
import type { WorkflowBundle } from "../../services/import_service"
import type { CurlParseOptions, HarParseOptions, ImportedNode } from "../../services/import_parsers"

const ws = z.string().min(1)

const WorkflowBundleInput: z.ZodType<WorkflowBundle> = z
  .object({
    workflow: z.object({
      workflowId: z.string().optional(),
      name: z.string(),
      description: z.string().optional(),
      nodes: z.array(JsonValueSchema),
      edges: z.array(JsonValueSchema),
      variables: z.record(z.string(), JsonValueSchema),
      tags: z.array(z.string()).optional(),
      environmentId: z.string().nullable().optional(),
      selectedEnvironmentId: z.string().nullable().optional(),
    }).passthrough(),
    environments: z.array(z.object({
      environmentId: z.string(),
      name: z.string(),
      description: z.string().nullable().optional(),
      variables: z.record(z.string(), JsonValueSchema),
      swaggerDocUrl: z.string().nullable().optional(),
    }).passthrough()).optional(),
    secretReferences: z.array(z.union([
      z.object({ name: z.string(), scopeType: z.string(), scopeId: z.string() }).strict(),
      z.string(), // ponytail: backward compat with old exports that stored secret names as strings
    ])).optional(),
    metadata: z.object({
      exportedAt: z.string(),
      workflowCount: z.number().optional(),
      environmentCount: z.number().optional(),
      secretReferenceCount: z.number().optional(),
    }).optional(),
  })
  .passthrough()

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
      timeout: z.number(),
      followRedirects: z.boolean(),
      extractors: z.record(z.string(), z.string()),
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

function buildOpenApiOpts(i: { baseUrl?: string; tagFilter?: string[]; sanitize?: boolean }) {
  const opts: { baseUrl?: string; tagFilter?: readonly string[]; sanitize?: boolean } = {}
  if (i.baseUrl !== undefined) opts["baseUrl"] = i.baseUrl
  if (i.tagFilter !== undefined) opts["tagFilter"] = i.tagFilter
  if (i.sanitize !== undefined) opts["sanitize"] = i.sanitize
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
      bundle: WorkflowBundleInput,
      createMissingEnvironments: z.boolean().optional(),
      sanitize: z.boolean().optional(),
    }).strict(),
    output: WorkflowImportResultSchema,
    handle: (i) => imports.importWorkflow(
      i.workspaceId,
      i.bundle,
      i.createMissingEnvironments ?? false,
      i.sanitize ?? true,
    ),
  })

  router.register("workflows", "dryRun", {
    input: z.object({
      workspaceId: ws,
      bundle: WorkflowBundleInput,
    }).strict(),
    output: WorkflowDryRunResultSchema,
    handle: (i) => imports.dryRunWorkflow(i.workspaceId, i.bundle),
  })

  router.register("workflows", "importOpenapi", {
    input: z.object({
      workspaceId: ws,
      spec: z.string(),
      baseUrl: z.string().optional(),
      tagFilter: z.array(z.string()).optional(),
      sanitize: z.boolean().optional(),
      dryRun: z.boolean().optional(),
    }).strict(),
    output: z.unknown(),
    handle: async (i) => {
      await deps.workspaces.get(i.workspaceId)
      const opts = buildOpenApiOpts(i)
      if (i.dryRun) return imports.previewOpenApi(i.spec, opts)
      return imports.parseOpenApi(i.spec, opts)
    },
  })

  router.register("workflows", "importOpenapiUrl", {
    input: z.object({
      workspaceId: ws,
      url: z.string().min(1),
      baseUrl: z.string().optional(),
      tagFilter: z.array(z.string()).optional(),
      sanitize: z.boolean().optional(),
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
      workflowId: z.string().optional(),
      collectionId: z.string().optional(),
    }).strict(),
    output: z.unknown(),
    handle: async (i) => {
      const sanitizeOpts = buildCurlOpts(i)
      if (i.dryRun) {
        return imports.dryRunCurl(i.curlCommand, sanitizeOpts)
      }
      return await imports.importCurlAsWorkflow(i.workspaceId, i.curlCommand, sanitizeOpts)
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
