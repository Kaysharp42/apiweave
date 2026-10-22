import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"

export const WorkspaceSchema = z
  .object({
    workspaceId: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    isPersonal: z.boolean().default(true),
    deletedAt: TimestampSchema.nullable().optional(),
    rev: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
