import { z } from "zod"

/**
 * Rerun part of a workflow, reusing what an earlier run of it settled.
 * With `nodeId` the run starts at that node ("Run from here"); without it, it
 * reruns every node the source run failed ("Rerun failed branches"). Either way
 * everything downstream runs too, and the nodes upstream keep the source run's
 * results and variables.
 */
export const RunResumeRequestSchema = z
  .object({
    fromRunId: z
      .string()
      .min(1)
      .optional()
      .describe("The finished run of this workflow to reuse results and variables from. Omitted: the workflow's latest run."),
    nodeId: z
      .string()
      .min(1)
      .optional()
      .describe("Start at this node. Omitted: rerun the nodes the source run failed, and what follows them."),
  })
  .strict()
