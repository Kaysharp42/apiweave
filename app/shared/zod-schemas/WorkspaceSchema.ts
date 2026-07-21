import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"
import { WorkspaceOriginSchema } from "./WorkspaceOriginSchema"
import { WorkspaceSyncModeSchema } from "./WorkspaceSyncModeSchema"

export const WorkspaceSchema = z
  .object({
    workspaceId: z.string().min(1),
    slug: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    isPersonal: z.boolean().default(true),
    origin: WorkspaceOriginSchema.default("local"),
    syncMode: WorkspaceSyncModeSchema.default("none"),
    deletedAt: TimestampSchema.nullable().optional(),
    rev: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
