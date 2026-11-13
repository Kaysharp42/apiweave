import { z } from "zod"

/**
 * Aggregate latency of one node across a load run's iterations, in whole
 * milliseconds. Every field is null when the node never ran. Percentiles use
 * the nearest-rank method over all observed durations.
 */
export const LoadLatencyStatsSchema = z
  .object({
    minMs: z.number().int().nonnegative().nullable(),
    meanMs: z.number().int().nonnegative().nullable(),
    p50Ms: z.number().int().nonnegative().nullable(),
    p90Ms: z.number().int().nonnegative().nullable(),
    p95Ms: z.number().int().nonnegative().nullable(),
    p99Ms: z.number().int().nonnegative().nullable(),
    maxMs: z.number().int().nonnegative().nullable(),
  })
  .strict()
