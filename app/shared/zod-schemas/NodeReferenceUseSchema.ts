import { z } from "zod"

/**
 * Where a node uses the reference a node search filtered on: the config key it
 * sits under (`url`, `headers`, `body`, `auth`, `scripts`, `extractors`,
 * `inputMapping`, `outputMapping`, `assertions`, …) and whether the node
 * produces the value (an extractor, an `outputMapping` key, `aw.variables.set`)
 * or consumes it. Names only — never the value.
 */
export const NodeReferenceUseSchema = z
  .object({
    field: z.string().min(1),
    role: z.enum(["produces", "consumes"]),
  })
  .strict()
