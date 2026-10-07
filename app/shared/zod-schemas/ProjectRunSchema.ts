import { z } from "zod"
import { ProjectRunItemSchema } from "./ProjectRunItemSchema"
import { TimestampSchema } from "./TimestampSchema"

/**
 * One run of a project's enabled workflows, in order, against one environment.
 * Each workflow is an ordinary run with its own history row; this record only
 * links them and says how far the project got.
 */
export const ProjectRunSchema = z
  .object({
    projectRunId: z.string().min(1),
    projectId: z.string().min(1),
    /** Null when the project ran with no environment, or the environment was since deleted. */
    environmentId: z.string().nullable(),
    status: z.enum(["pending", "running", "completed", "failed", "cancelled", "interrupted"]),
    startedAt: TimestampSchema,
    finishedAt: TimestampSchema.nullable(),
    items: z.array(ProjectRunItemSchema),
  })
  .strict()
