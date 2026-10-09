import { z } from "zod"

/** A GraphQL request (`bodyType: "graphql"`), sent per GraphQL over HTTP. */
export const GraphqlBodySchema = z
  .object({
    query: z.string().describe("The GraphQL document: a query, mutation or subscription. Placeholders are substituted."),
    variables: z
      .string()
      .optional()
      .describe(
        'The variables as JSON object TEXT, e.g. "{\\"id\\": {{variables.userId}}}". Placeholders are substituted JSON-aware: inside a string literal the value is escaped, standing alone it is inserted raw (a number, an object).',
      ),
    operationName: z.string().optional().describe("Which operation to run when the document defines several."),
  })
  .strict()
