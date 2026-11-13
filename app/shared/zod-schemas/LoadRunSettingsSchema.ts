import { z } from "zod"

/**
 * The settings a load run was started with, recorded so its report can say
 * how it ran. `durationMs` and `rampUpMs` are null when not set.
 */
export const LoadRunSettingsSchema = z
  .object({
    /** Iterations in flight at once. */
    concurrency: z.number().int().positive(),
    /** Optional wall-clock cap: stop launching iterations after this long. */
    durationMs: z.number().int().positive().nullable(),
    /** Optional ramp-up: spread the first batch so concurrency grows over this long. */
    rampUpMs: z.number().int().positive().nullable(),
    /** Threshold expressions as written, e.g. `p95<500`, `errors<1%`. */
    thresholds: z.array(z.string().min(1)),
  })
  .strict()
