import { z } from "zod"
import { WorkflowCallForEachSchema } from "./WorkflowCallForEachSchema"

/**
 * Per-node CONFIG schema for `type: "workflow"` (Call Workflow) nodes.
 *
 * `inputMapping` keys are variable names the target workflow will see as
 * `{{variables.<key>}}`; values are placeholder expressions resolved in the
 * CALLER's context (e.g. `{{variables.userId}}`, `{{env.BASE_URL}}`, or a
 * literal) — reusing the executor's existing substitution grammar rather than
 * inventing a second one.
 *
 * `outputMapping` keys are variable names written into the CALLER's scope;
 * values are variable names read from the target workflow's final
 * `extractedVariables` snapshot after it completes. Under `forEach`, each
 * mapped variable becomes an array, one entry per item in item order.
 */
export const WorkflowCallNodeDataSchema = z
  .object({
    targetWorkflowId: z
      .string()
      .min(1)
      .nullable()
      .optional()
      .describe(
        "The called workflow's id. Must live in the same workspace and cannot be the calling workflow; nesting is capped at 8 levels. The node fails when this is missing or its target cannot be resolved.",
      ),
    targetWorkflowName: z
      .string()
      .nullable()
      .optional()
      .describe(
        "Denormalized display name, refreshed whenever the picker sets a new target — avoids a workspace-wide lookup just to render the canvas. Not authoritative; the runner only ever reads `targetWorkflowId`.",
      ),
    inputMapping: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        'Maps a target-workflow variable name to an expression resolved in the CALLER\'s context before the call: {{variables.x}}, {{env.X}} or a literal. A {{secrets.NAME}} here is rejected — the sub-workflow shares the caller\'s secrets and reads them itself.',
      ),
    outputMapping: z
      .record(z.string(), z.string())
      .optional()
      .describe(
        "Maps a caller variable name to a variable name read from the target's final variables after it completes. Under `forEach` each mapped variable becomes an array, one entry per item in item order (null where an iteration did not run or did not produce the variable).",
      ),
    forEach: WorkflowCallForEachSchema.optional().describe(
      "Runs the target once per element of `items` instead of once: the sub-workflow sees the element as `itemVariable` and its zero-based index as `indexVariable`, iterations run up to `concurrency` at a time, and the node passes only when every iteration passes.",
    ),
  })
  .strict()
