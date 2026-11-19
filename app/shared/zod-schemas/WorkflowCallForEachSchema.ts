import { z } from "zod"

/** Highest number of iterations a Call Workflow for-each may run in flight at once. */
export const WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY = 16

/** The iteration count a Call Workflow for-each is capped at; further items are not run. */
export const WORKFLOW_CALL_FOR_EACH_MAX_ITERATIONS = 1000

/**
 * Config for the optional `forEach` on a `type: "workflow"` node.
 *
 * `items` is a placeholder, a JSON array literal or a `$` JSONPath that
 * resolves to the array the sub-workflow runs once per element of.
 * `itemVariable` and `indexVariable` name the variables the sub-workflow sees
 * for the current element and its zero-based index. Both `items` and
 * `itemVariable` are lenient here so a half-configured for-each never blocks a
 * workflow save; the runner validates them and fails the node with a clear
 * message when they are missing.
 */
export const WorkflowCallForEachSchema = z
  .object({
    items: z
      .string()
      .optional()
      .describe(
        'The items to run the target once per element of: a single {{...}} placeholder whose value is an array ({{variables.ids}}, {{fetchIds.response.body.items}}), a JSON array literal ([1,2]), or a "$" JSONPath rooted at { variables, env, data, <nodeId>: result } ($.fetch.response.body.items). Capped at 1000 items; further items are not run. The node fails when this is missing or does not resolve to an array.',
      ),
    itemVariable: z
      .string()
      .optional()
      .describe(
        "Required at run time: the target-workflow variable receiving the current item, read as {{variables.<name>}}. The node fails when this is missing.",
      ),
    indexVariable: z
      .string()
      .optional()
      .describe("Optional: the target-workflow variable receiving the current item's zero-based index."),
    concurrency: z
      .number()
      .int()
      .min(1)
      .max(WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY)
      .optional()
      .describe(
        "How many iterations run at once, from 1 to 16. Defaults to 1 (sequential). Above 1 fails the node at run time when the target has browser steps, because iterations share one page.",
      ),
    stopOnFailure: z
      .boolean()
      .optional()
      .describe(
        "When true (the default), stop starting iterations after the first failure. When false, run every item and report how many failed.",
      ),
  })
  .strict()
