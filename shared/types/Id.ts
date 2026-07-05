import type { z } from "zod"
import type { IdSchema } from "../zod-schemas/IdSchema"

export type Id = z.infer<typeof IdSchema>
