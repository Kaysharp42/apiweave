import { z } from "zod"
import { NodeReferenceUseSchema } from "./NodeReferenceUseSchema"

/**
 * One node matched by a safe-field search. `matchedOn` names which fields
 * matched (nodeId, label, type, method, urlPath, extractor, target, ref).
 * Request nodes carry `method` and `urlPath` (the path template: no host, query
 * string or userinfo). `workflowId` and `workflowName` appear on a
 * workspace-wide search (a one-workflow page states its workflowId once);
 * `neighborNodeIds`/`incidentEdgeIds` on a one-workflow search, where they are
 * enough to fetch or patch without a full-graph read. `references` appears when
 * the search filtered on a `ref`.
 */
export const WorkflowNodeMatchSchema = z
  .object({
    workflowId: z.string().min(1).optional(),
    workflowName: z.string().optional(),
    nodeId: z.string().min(1),
    type: z.string().min(1),
    label: z.string().nullable(),
    method: z.string().optional(),
    urlPath: z.string().optional(),
    matchedOn: z.array(z.string().min(1)),
    references: z.array(NodeReferenceUseSchema).optional(),
    neighborNodeIds: z.array(z.string().min(1)).optional(),
    incidentEdgeIds: z.array(z.string().min(1)).optional(),
  })
  .strict()
