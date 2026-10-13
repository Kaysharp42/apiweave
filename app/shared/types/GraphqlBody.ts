import type { z } from "zod"
import type { GraphqlBodySchema } from "../zod-schemas/GraphqlBodySchema"

export type GraphqlBody = z.infer<typeof GraphqlBodySchema>
