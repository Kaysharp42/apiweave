import type { z } from "zod"
import type { PositionSchema } from "../zod-schemas/PositionSchema"

export type Position = z.infer<typeof PositionSchema>
