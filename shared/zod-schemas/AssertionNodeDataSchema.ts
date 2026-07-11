import { z } from "zod"
import { AssertionItemSchema } from "./AssertionItemSchema"

/**
 * Per-node CONFIG schema for `type: "assertion"` nodes.
 *
 * Runtime canvas state (`label`, `executionStatus`, `invalid`) lives on the
 * renderer's `WorkflowCanvasNodeData` and is intentionally absent from the
 * persisted workflow definition. See {@link HTTPNodeDataSchema} for the
 * rationale on dropping the legacy double-nested `config.config` wrapper.
 */
export const AssertionNodeDataSchema = z
  .object({
    assertions: z.array(AssertionItemSchema).optional(),
    continueOnFail: z.boolean().optional(),
  })
  .strict()