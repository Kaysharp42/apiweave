import { z } from "zod"

export const WorkflowEdgeSchema = z
  .object({
    edgeId: z.string().min(1),
    source: z.string().min(1),
    target: z.string().min(1),
    sourceHandle: z.string().nullable().optional(),
    targetHandle: z.string().nullable().optional(),
    label: z.string().nullable().optional(),
  })
  .strict()
