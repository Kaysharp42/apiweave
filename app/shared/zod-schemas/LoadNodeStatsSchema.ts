import { z } from "zod"
import { LoadLatencyStatsSchema } from "./LoadLatencyStatsSchema"

/**
 * One node's aggregate across a load run's iterations: how often it ran, how
 * many iterations it failed, its latency distribution and throughput. A load
 * run retains this — never every iteration's full response.
 */
export const LoadNodeStatsSchema = z
  .object({
    nodeId: z.string().min(1),
    /** The node's label on the canvas; falls back to `nodeId` in the report. */
    label: z.string(),
    /** The node type, kept so a report can group or exclude nodes. */
    type: z.string(),
    /** Iterations in which this node executed. */
    count: z.number().int().nonnegative(),
    /** Iterations in which this node failed. */
    errorCount: z.number().int().nonnegative(),
    /** `errorCount / count`, from 0 to 1; 0 when the node never ran. */
    errorRate: z.number().min(0).max(1),
    latency: LoadLatencyStatsSchema,
    /** Executions per second across the load run's wall time; 0 when it never ran. */
    throughput: z.number().nonnegative(),
  })
  .strict()
