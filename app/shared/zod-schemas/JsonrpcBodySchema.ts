import { z } from "zod"

/** A JSON-RPC 2.0 request (`bodyType: "jsonrpc"`), POSTed as application/json. */
export const JsonrpcBodySchema = z
  .object({
    method: z.string().describe('The JSON-RPC method to invoke, e.g. "subtract" or "eth_blockNumber". Placeholders are substituted.'),
    params: z
      .string()
      .optional()
      .describe(
        'The params as JSON template TEXT — an object (by name) or array (by position), e.g. "{\\"a\\": {{variables.a}}}" or "[1, 2]". Placeholders are substituted JSON-aware. Omit when the method takes none.',
      ),
    notification: z
      .boolean()
      .optional()
      .describe('When true the request is a JSON-RPC notification: the `id` member is omitted and a server response (which must be empty) is not treated as a failure.'),
  })
  .strict()
