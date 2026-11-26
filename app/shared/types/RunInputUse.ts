import type { z } from "zod"
import type { RunInputUseSchema } from "../zod-schemas/RunInputCheckSchema"

export type RunInputUse = z.infer<typeof RunInputUseSchema>
