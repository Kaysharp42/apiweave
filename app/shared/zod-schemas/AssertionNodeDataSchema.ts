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
    assertions: z
      .array(AssertionItemSchema)
      .optional()
      .describe('The rules this node checks. The node takes the "pass" branch only when every rule passes, otherwise the "fail" branch.'),
    continueOnFail: z.boolean().optional().describe("When true, a failing assertion does not stop the run."),
    failureMode: z
      .enum(["first", "all"])
      .optional()
      .describe('"first" stops evaluating at the first failing rule; "all" evaluates every rule and reports each outcome.'),
  })
  .strict()