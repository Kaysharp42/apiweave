import { z } from "zod"

/**
 * One node matched by a workspace-wide safe-field search, with what the
 * command palette prints for it: the workflow it lives in, its method and its
 * URL path (query string dropped — the same surface the search matched).
 */
export const WorkspaceNodeMatchSchema = z
  .object({
    workflowId: z.string().min(1),
    workflowName: z.string(),
    nodeId: z.string().min(1),
    type: z.string().min(1),
    label: z.string().nullable(),
    method: z.string().nullable(),
    urlPath: z.string().nullable(),
    matchedOn: z.array(z.string().min(1)),
  })
  .strict()
