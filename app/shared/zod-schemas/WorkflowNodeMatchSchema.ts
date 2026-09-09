import { z } from "zod"

/**
 * One node matched by a safe-field search. `matchedOn` names which safe
 * fields matched (nodeId, label, type, method, urlPath, extractor, target);
 * `neighborNodeIds` and `incidentEdgeIds` carry enough surrounding structure
 * to fetch or patch without a full-graph read.
 */
export const WorkflowNodeMatchSchema = z
  .object({
    nodeId: z.string().min(1),
    type: z.string().min(1),
    label: z.string().nullable(),
    matchedOn: z.array(z.string().min(1)),
    neighborNodeIds: z.array(z.string().min(1)),
    incidentEdgeIds: z.array(z.string().min(1)),
  })
  .strict()
