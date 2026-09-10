import { z } from "zod"
import { McpWorkflowDiagnosisSchema } from "./McpWorkflowDiagnosisSchema"
import { RevisionSchema } from "./RevisionSchema"

export const McpWorkflowWriteResultSchema = z
  .object({
    workflowId: z.string().min(1),
    rev: RevisionSchema,
    nodeCount: z.number().int().nonnegative(),
    edgeCount: z.number().int().nonnegative(),
    touchedNodeIds: z.array(z.string().min(1)),
    touchedNodeIdsTotal: z.number().int().nonnegative(),
    touchedEdgeIds: z.array(z.string().min(1)),
    touchedEdgeIdsTotal: z.number().int().nonnegative(),
  })
  .strict()

export const McpWorkflowWriteToolResultSchema = z
  .object({
    result: McpWorkflowWriteResultSchema,
    diagnosis: McpWorkflowDiagnosisSchema,
  })
  .strict()
