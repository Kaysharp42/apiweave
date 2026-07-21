import type { z } from "zod"
import type { TimestampSchema } from "../zod-schemas/TimestampSchema"

export type Timestamp = z.infer<typeof TimestampSchema>
