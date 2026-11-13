import { z } from "zod"
import { AuthConfigSchema } from "./AuthConfigSchema"
import { KeyValuePairSchema } from "./KeyValuePairSchema"
import { StreamFinishConditionSchema } from "./StreamFinishConditionSchema"

/** One message sent on the socket after the handshake. */
export const WebsocketMessageSchema = z
  .object({
    data: z.string().describe("Message payload. For a binary message, base64-encoded bytes. Placeholders are substituted at run time."),
    type: z.enum(["text", "binary"]).default("text").describe('How to send the message: as a UTF-8 text frame, or as binary (the base64 `data` is decoded first).'),
    delayMs: z.number().int().min(0).max(300_000).optional().describe("Pause this many milliseconds before sending this message."),
  })
  .strict()

/**
 * A bounded WebSocket listener. It signals its ready output once the handshake
 * completes (and its outbound messages are sent), collects incoming messages,
 * and closes on a capture limit, a finish rule, or a timeout.
 */
export const WebsocketNodeDataSchema = z
  .object({
    url: z.string().optional().describe("ws:// or wss:// endpoint URL. Placeholders are substituted at run time."),
    queryParams: z.array(KeyValuePairSchema).optional().describe("Query string parameters as {key, value} pairs."),
    headers: z.array(KeyValuePairSchema).optional().describe("Handshake request headers as {key, value} pairs."),
    auth: AuthConfigSchema.optional().describe("Authentication applied to the handshake headers."),
    subprotocols: z.array(z.string().min(1).max(256)).max(8).optional().describe("WebSocket subprotocols requested in the handshake."),
    messages: z.array(WebsocketMessageSchema).max(100).optional().describe("Messages sent in order after the handshake."),
    timeout: z.number().int().min(0).max(300).optional().describe("Maximum time to wait for matching messages, in seconds. Zero waits until a finish rule matches."),
    maxMessages: z.number().int().positive().max(100).optional().describe("Maximum incoming messages retained in the bounded result. Without finish rules, reaching this limit closes the connection. Defaults to 1."),
    finishConditions: z.array(StreamFinishConditionSchema).max(20).optional().describe("All rules must match one received message to close the connection and activate the Complete output."),
    sslVerify: z.boolean().optional(),
    continueOnFail: z.boolean().optional(),
    extractors: z.record(z.string(), z.string()).optional().describe('Captures values from the collected result, e.g. {"id": "response.body.messages[0].data"}.'),
  })
  .strict()
  .superRefine((config, context) => {
    if (config.timeout === 0 && (config.finishConditions?.length ?? 0) === 0) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ["timeout"], message: "A timeout of 0 requires at least one finish condition." })
    }
  })
