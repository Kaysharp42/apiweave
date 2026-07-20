import { z } from "zod"

export const BearerAuthConfigSchema = z
  .object({ token: z.string() })
  .strict()

export const BasicAuthConfigSchema = z
  .object({ username: z.string(), password: z.string() })
  .strict()

export const ApiKeyAuthConfigSchema = z
  .object({ key: z.string(), value: z.string(), addTo: z.enum(["header", "query"]) })
  .strict()

export const AuthConfigSchema = z
  .object({
    type: z.enum(["none", "bearer", "basic", "apiKey"]),
    bearer: BearerAuthConfigSchema.optional(),
    basic: BasicAuthConfigSchema.optional(),
    apiKey: ApiKeyAuthConfigSchema.optional(),
  })
  .strict()