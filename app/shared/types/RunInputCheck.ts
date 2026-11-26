import type { z } from "zod"
import type { RunInputCheckSchema } from "../zod-schemas/RunInputCheckSchema"

export type RunInputCheck = z.infer<typeof RunInputCheckSchema>
