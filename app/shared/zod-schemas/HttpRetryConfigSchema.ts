import { z } from "zod"
import { AssertionItemSchema } from "./AssertionItemSchema"

/**
 * Repeats an http-request node's request: polling an async API until it
 * reports done, or riding out a transient failure. Workflows have no loops, so
 * this is the structured way to send a request more than once.
 *
 * With `until`, the request repeats until every rule passes against the
 * attempt's own response (`prev` and `status` read this node's response, not
 * an upstream one), or a request cannot be sent at all. Without `until`, it
 * repeats only on a network error, a timeout or a 5xx. Whether the final
 * response passes is still decided by the 2xx rule or `expectedStatus`.
 */
export const HttpRetryConfigSchema = z
  .object({
    maxAttempts: z.number().int().min(1).max(100).describe("Total attempts, the first request included."),
    intervalMs: z
      .number()
      .int()
      .min(0)
      .max(600_000)
      .describe("Wait between attempts, in milliseconds. With exponential backoff, the wait before the second attempt."),
    backoff: z
      .enum(["fixed", "exponential"])
      .optional()
      .describe('"fixed" (default) waits intervalMs every time; "exponential" doubles the wait after each attempt.'),
    maxIntervalMs: z
      .number()
      .int()
      .positive()
      .max(3_600_000)
      .optional()
      .describe("Upper bound on a single wait, for exponential backoff."),
    until: z
      .array(AssertionItemSchema)
      .max(20)
      .optional()
      .describe(
        'Stop condition: assertion rules that must all pass against this node\'s own response, e.g. [{"source": "status", "path": "", "operator": "equals", "expectedValue": 200}, {"source": "prev", "path": "response.body.status", "operator": "equals", "expectedValue": "done"}]. Omit to repeat only on network errors, timeouts and 5xx responses.',
      ),
  })
  .strict()
