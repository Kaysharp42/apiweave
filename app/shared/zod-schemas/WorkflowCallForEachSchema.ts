import { z } from "zod"

/** Highest number of iterations a Call Workflow for-each may run in flight at once. */
export const WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY = 16

/** The iteration count a Call Workflow for-each is capped at; further items are not run. */
export const WORKFLOW_CALL_FOR_EACH_MAX_ITERATIONS = 1000

/**
 * Config for the optional `forEach` on a `type: "workflow"` node.
 *
 * `items` is a placeholder or JSON array literal that resolves to the array the
 * sub-workflow runs once per element of. `itemVariable` and `indexVariable`
 * name the variables the sub-workflow sees for the current element and its
 * zero-based index. Both `items` and `itemVariable` are lenient here so a
 * half-configured for-each never blocks a workflow save; the runner validates
 * them and fails the node with a clear message when they are missing.
 */
export const WorkflowCallForEachSchema = z
  .object({
    /** A placeholder (`{{variables.ids}}`, `{{fetchIds.response.body.items}}`) or a JSON array literal resolving to the items to iterate. */
    items: z.string().optional(),
    /** The child variable receiving the current item. */
    itemVariable: z.string().optional(),
    /** The child variable receiving the current item's zero-based index. Optional. */
    indexVariable: z.string().optional(),
    /** How many iterations run at once, from 1 to 16. Defaults to 1 (sequential). */
    concurrency: z.number().int().min(1).max(WORKFLOW_CALL_FOR_EACH_MAX_CONCURRENCY).optional(),
    /** When true (default), stop starting iterations after the first failure. When false, run every iteration and report how many failed. */
    stopOnFailure: z.boolean().optional(),
  })
  .strict()
