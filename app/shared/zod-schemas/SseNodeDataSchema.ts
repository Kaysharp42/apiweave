import { z } from "zod"
import { AuthConfigSchema } from "./AuthConfigSchema"
import { KeyValuePairSchema } from "./KeyValuePairSchema"
import { SseFinishConditionSchema } from "./SseFinishConditionSchema"

/**
 * A bounded Server-Sent Events listener. It signals its ready output once the
 * handshake succeeds, and closes on a capture limit or an event finish rule.
 */
export const SseNodeDataSchema = z
  .object({
    url: z.string().optional().describe("SSE endpoint URL. Placeholders are substituted at run time."),
    queryParams: z.array(KeyValuePairSchema).optional().describe("Query string parameters as {key, value} pairs."),
    headers: z.array(KeyValuePairSchema).optional().describe("Request headers as {key, value} pairs."),
    auth: AuthConfigSchema.optional(),
    timeout: z.number().int().min(0).max(300).optional().describe("Maximum time to wait for matching events, in seconds. Zero waits until a finish rule matches."),
    followRedirects: z.boolean().optional(),
    sslVerify: z.boolean().optional(),
    eventType: z.string().min(1).max(256).optional().describe("Only collect events whose SSE event field exactly matches this type."),
    maxEvents: z.number().int().positive().max(100).optional().describe("Maximum matching events retained in the bounded result. Without finish rules, reaching this limit closes the stream. Defaults to 1."),
    finishConditions: z.array(SseFinishConditionSchema).max(20).optional().describe("All rules must match one received event to close the stream and activate the Complete output."),
    continueOnFail: z.boolean().optional(),
    extractors: z.record(z.string(), z.string()).optional().describe('Captures values from the collected stream result, e.g. {"id": "response.body.events[0].id"}.'),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.timeout === 0 && (config.finishConditions?.length ?? 0) === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["timeout"], message: "A timeout of 0 requires at least one finish condition." })
    }
  })
