import { z } from "zod"

/**
 * Safe metadata about one `{{secrets.NAME}}` reference resolved during a run.
 * Records whether the secret resolved and at which scope it won — never the
 * value, ciphertext, or key material. Surfaced to the renderer for masked-secret
 * debug confidence (feature 5.3).
 */
export const ResolvedSecretInfoSchema = z
  .object({
    name: z.string().min(1),
    scopeType: z.enum(["environment", "workspace"]).nullable(),
    resolved: z.boolean(),
  })
  .strict()

export type ResolvedSecretInfo = z.infer<typeof ResolvedSecretInfoSchema>