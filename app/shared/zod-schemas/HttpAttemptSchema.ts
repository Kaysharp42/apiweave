import { z } from "zod"

/** One request a retrying http-request node sent: what came back, or why nothing did. */
export const HttpAttemptSchema = z
  .object({
    statusCode: z.number().int().optional(),
    duration: z.number().int().nonnegative(),
    error: z.string().optional(),
  })
  .strict()
