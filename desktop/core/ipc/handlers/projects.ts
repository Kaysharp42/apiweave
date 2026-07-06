import { z } from "zod"
import { JsonValueSchema } from "../../../../shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { ProjectBundle } from "../../services/project_export_service"
import type { HandlerDeps } from "./common"

const ws = z.string().min(1)

const SecretReferenceSchema = z.object({ name: z.string(), scopeType: z.string(), scopeId: z.string() }).strict()

const ExportedWorkflowSchema = z
  .object({
    workflowId: z.string(),
    name: z.string(),
    description: z.string(),
    nodes: z.array(JsonValueSchema),
    edges: z.array(JsonValueSchema),
    variables: z.record(z.string(), JsonValueSchema),
    tags: z.array(z.string()),
    selectedEnvironmentId: z.string().nullable(),
  })
  .strict()

const ExportedEnvironmentSchema = z
  .object({
    environmentId: z.string(),
    name: z.string(),
    description: z.string().nullable(),
    scopeType: z.string(),
    scopeId: z.string(),
    variables: z.record(z.string(), JsonValueSchema),
    swaggerDocUrl: z.string().nullable(),
  })
  .strict()

/** Output shape mirror of {@link ProjectBundle} — defense-in-depth on the v2 export. */
const ProjectBundleSchema = z
  .object({
    schemaVersion: z.string(),
    type: z.literal("awecollection"),
    project: z
      .object({ projectId: z.string(), name: z.string(), description: z.string(), color: z.string() })
      .strict(),
    workflows: z.array(ExportedWorkflowSchema),
    environments: z.array(ExportedEnvironmentSchema),
    secretReferences: z.array(SecretReferenceSchema),
    metadata: z
      .object({
        exportedAt: z.string(),
        schemaVersion: z.string(),
        workflowCount: z.number(),
        environmentCount: z.number(),
        secretReferenceCount: z.number(),
      })
      .strict(),
  })
  .strict()

const ImportResultSchema = z
  .object({
    projectId: z.string(),
    workflowCount: z.number(),
    environmentCount: z.number(),
    secretReferences: z.number(),
    missingSecrets: z.array(z.string()),
    warnings: z.array(z.string()),
  })
  .strict()

const DryRunResultSchema = z
  .object({
    valid: z.boolean(),
    errors: z.array(z.string()),
    warnings: z.array(z.string()),
    stats: z
      .object({
        schemaVersion: z.string(),
        workflows: z.number(),
        environments: z.number(),
        secretReferences: z.number(),
        missingSecrets: z.number(),
      })
      .strict(),
  })
  .strict()

/**
 * Lenient input for an untrusted bundle read from a user's file. Rejects non-objects
 * at the boundary; deep validation (structure, fail-closed no-secret guard, schema
 * drift) is the service's job, so schemaVersion stays a plain string — a stale-version
 * bundle must reach `dryRunImport` to be *reported*, not rejected here.
 */
const BundleInputSchema = z
  .object({
    schemaVersion: z.string().optional(),
    type: z.string().optional(),
    project: z.unknown().optional(),
    workflows: z.array(z.unknown()).optional(),
    environments: z.array(z.unknown()).optional(),
    secretReferences: z.array(z.unknown()).optional(),
    metadata: z.unknown().optional(),
  })
  .passthrough()

export function registerProjectHandlers(router: IpcRouter, deps: HandlerDeps): void {
  const { projects } = deps

  router.register("projects", "export", {
    input: z.object({ workspaceId: ws, projectId: z.string().min(1) }).strict(),
    output: ProjectBundleSchema,
    handle: (i) => projects.exportProject(i.workspaceId, i.projectId),
  })

  router.register("projects", "import", {
    input: z.object({ workspaceId: ws, bundle: BundleInputSchema }).strict(),
    output: ImportResultSchema,
    // ponytail: service re-validates fail-closed, so the cast past the lenient input is safe.
    handle: (i) => projects.importProject(i.workspaceId, i.bundle as unknown as ProjectBundle),
  })

  router.register("projects", "dryRun", {
    input: z.object({ workspaceId: ws, bundle: BundleInputSchema }).strict(),
    output: DryRunResultSchema,
    handle: (i) => projects.dryRunImport(i.workspaceId, i.bundle as unknown as ProjectBundle),
  })
}
