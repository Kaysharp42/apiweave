import { z } from "zod"

/** Endpoint identity carried on an HTTP node imported from OpenAPI, used to detect spec drift on refresh. */
export const OpenApiNodeMetaSchema = z
  .object({
    source: z.literal("openapi"),
    method: z.string(),
    path: z.string(),
    operationId: z.string().nullable(),
    fingerprint: z.string(),
    definitionName: z.string().optional(),
    definitionSpecUrl: z.string().optional(),
    definitionScope: z.string().optional(),
    sourceUiUrl: z.string().optional(),
  })
  .strict()
