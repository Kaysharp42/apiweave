import type { z } from "zod"
import type { LoadRunSchema } from "../zod-schemas/LoadRunSchema"

export type LoadRun = z.infer<typeof LoadRunSchema>
