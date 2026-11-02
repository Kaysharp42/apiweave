import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { RunSchema } from "./RunSchema"

const names = z.array(z.string().min(1)).optional()

/**
 * One workflow in the workspace map, built from safe fields only: endpoints as
 * `METHOD /path/{{…}}` (no host, query string or userinfo), variable names it
 * produces and consumes, env and secret reference names, and the workflows its
 * `workflow` nodes call. An empty list is omitted; `omitted` counts entries a
 * capped list leaves out. `lastRun` is absent for a workflow never run.
 */
export const WorkspaceMapEntrySchema = z
  .object({
    workflowId: z.string().min(1),
    name: z.string(),
    rev: RevisionSchema,
    collectionId: z.string().min(1).nullable(),
    endpoints: names,
    produces: names,
    consumes: names,
    env: names,
    secrets: names,
    calls: names,
    omitted: z.record(z.string(), z.number().int().positive()).optional(),
    lastRun: z.object({ runId: z.string().min(1), status: RunSchema.shape.status }).strict().optional(),
  })
  .strict()
