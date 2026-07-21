import type { z } from "zod"
import type { JsonValueSchema } from "../zod-schemas/JsonValueSchema"

export type JsonValue = z.infer<typeof JsonValueSchema>
