import { z } from "zod"
import { JsonValueSchema } from "./JsonValueSchema"
import { RevisionSchema } from "./RevisionSchema"
import { TimestampSchema } from "./TimestampSchema"

export const EnvironmentSchema = z
  .object({
    environmentId: z.string().min(1),
    workspaceId: z.string().min(1),
    name: z.string().min(1),
    description: z.string().nullable().optional(),
    swaggerDocUrl: z.string().nullable().optional(),
    variables: z.record(z.string(), JsonValueSchema).default({}),
    secrets: z.record(z.string(), JsonValueSchema).default({}),
    isDefault: z.boolean().default(false),
    rev: RevisionSchema,
    createdAt: TimestampSchema,
    updatedAt: TimestampSchema,
  })
  .strict()
