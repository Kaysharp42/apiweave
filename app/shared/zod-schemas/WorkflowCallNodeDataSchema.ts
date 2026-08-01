import { z } from "zod"

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
 * `extractedVariables` snapshot after it completes.
 */
export const WorkflowCallNodeDataSchema = z
  .object({
    targetWorkflowId: z.string().min(1).nullable().optional(),
    /** Denormalized display name, refreshed whenever the picker sets a new target — avoids a workspace-wide lookup just to render the canvas. Not authoritative; the runner only ever reads `targetWorkflowId`. */
    targetWorkflowName: z.string().nullable().optional(),
    inputMapping: z.record(z.string(), z.string()).optional(),
    outputMapping: z.record(z.string(), z.string()).optional(),
  })
  .strict()
