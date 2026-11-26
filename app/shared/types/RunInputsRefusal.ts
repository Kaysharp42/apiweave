import type { z } from "zod"
import type { RunInputsRefusalSchema } from "../zod-schemas/RunInputCheckSchema"

export type RunInputsRefusal = z.infer<typeof RunInputsRefusalSchema>
