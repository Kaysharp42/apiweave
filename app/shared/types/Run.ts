import type { z } from "zod"
import type { RunSchema } from "../zod-schemas/RunSchema"

export type Run = z.infer<typeof RunSchema>
