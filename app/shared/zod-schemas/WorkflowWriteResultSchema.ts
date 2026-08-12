import { z } from "zod"
import { RevisionSchema } from "./RevisionSchema"
import { WorkflowDiagnosisSchema } from "./WorkflowDiagnosisSchema"
import { WorkflowSchema } from "./WorkflowSchema"

/**
 * The JSON projected from `workflows_create` / `workflows_update` /
 * `workflows_patch` when the caller asks for a response smaller than the full
 * persisted workflow echo. The full echo blew MCP token budgets on large graphs
 * (a single-rule patch returned all 130 nodes and 194 edges). The default
 * `return` shape per tool decides which arm this matches.
 *
 * Three variants, discriminated on `kind`:
 *
 * - `"summary"` (default for `workflows_patch`): `workflowId`, `rev`, node and
 *   edge counts, the ids actually touched by the write, and the full
 *   `diagnosis`. That is everything the documented "patch then read the
 *   diagnosis" loop needs.
 * - `"diagnosis"`: `workflowId`, `rev` and `diagnosis` only — for callers that
 *   already know what the graph looks like and only want the action's verdict.
 * - the bare {@link WorkflowSchema}: the full echo, when `return: "full"` is
 *   requested (this arm has no `kind` discriminator — it is the legacy shape
 *   the renderer reads).
 */
const WorkflowWriteSummarySchema = z
  .object({
    kind: z.literal("summary"),
    workflowId: z.string().min(1),
    rev: RevisionSchema,
    nodeCount: z.number().int(),
    edgeCount: z.number().int(),
    touchedNodeIds: z.array(z.string().min(1)),
    touchedEdgeIds: z.array(z.string().min(1)),
    diagnosis: WorkflowDiagnosisSchema,
  })
  .strict()

const WorkflowWriteDiagnosisSchema = z
  .object({
    kind: z.literal("diagnosis"),
    workflowId: z.string().min(1),
    rev: RevisionSchema,
    diagnosis: WorkflowDiagnosisSchema,
  })
  .strict()

export const WorkflowWriteResultSchema = z.union([
  WorkflowSchema,
  WorkflowWriteSummarySchema,
  WorkflowWriteDiagnosisSchema,
])