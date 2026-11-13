import { z } from "zod"
import { AssertionOperatorSchema } from "./AssertionOperatorSchema"
import { JsonValueSchema } from "./JsonValueSchema"

/**
 * A finish rule evaluated against each normalized stream message (SSE event,
 * WebSocket frame, …). The message's `data` is treated as JSON when it parses
 * successfully, so `data.status` can address a JSON payload; otherwise it
 * remains the raw string payload.
 */
export const StreamFinishConditionSchema = z
  .object({
    path: z.string().min(1).max(1024).describe('Message value to inspect: "event", "id", "type", "data", or a JSON payload path such as "data.status"; a "$"-prefixed path is JSONPath rooted at the message, e.g. "$.data.status".'),
    operator: AssertionOperatorSchema.describe("Comparison to apply to the message value."),
    expectedValue: JsonValueSchema.optional().describe("Expected value. Omit for exists and notExists."),
  })
  .strict()
