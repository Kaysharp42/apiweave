import { z } from "zod"
import { MergeConditionSchema } from "./MergeConditionSchema"

/**
 * Per-node CONFIG schema for `type: "merge"` nodes.
 *
 * Runtime canvas state (`label`, `executionStatus`, `status`, `result`,
 * `incomingBranchCount`) lives on the renderer's `WorkflowCanvasNodeData`
 * and is intentionally absent from the persisted workflow definition. See
 * {@link HTTPNodeDataSchema} for the rationale on dropping the legacy
 * double-nested `config.config` wrapper.
 */
export const MergeNodeDataSchema = z
  .object({
    mergeStrategy: z.enum(["all", "any", "first", "conditional"]).optional(),
    conditions: z.array(MergeConditionSchema).optional(),
    conditionLogic: z.enum(["AND", "OR"]).optional(),
    continueOnFail: z.boolean().optional(),
  })
  .strict()