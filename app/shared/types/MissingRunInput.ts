import type { z } from "zod"
import type { MissingRunInputSchema } from "../zod-schemas/RunInputCheckSchema"

export type MissingRunInput = z.infer<typeof MissingRunInputSchema>
