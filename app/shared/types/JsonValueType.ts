import type { z } from "zod"
import type { JsonValueTypeSchema } from "../zod-schemas/JsonValueTypeSchema"

export type JsonValueType = z.infer<typeof JsonValueTypeSchema>
