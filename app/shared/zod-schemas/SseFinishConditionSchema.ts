import { z } from "zod"
import { AssertionOperatorSchema } from "./AssertionOperatorSchema"
import { JsonValueSchema } from "./JsonValueSchema"

/**
 * A rule evaluated against each matching SSE event. `data` is treated as JSON
 * when it parses successfully, so `data.status` can address a JSON payload;
 * otherwise it remains the event's raw string payload.
 */
export const SseFinishConditionSchema = z
  .object({
    path: z.string().min(1).max(1024).describe('Event value to inspect: "event", "id", "data", or a JSON payload path such as "data.status".'),
    operator: AssertionOperatorSchema.describe("Comparison to apply to the event value."),
    expectedValue: JsonValueSchema.optional().describe("Expected value. Omit for exists and notExists."),
  })
  .strict()
