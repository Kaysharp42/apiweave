import type { z } from "zod"
import type { SchemaViolationSchema } from "../zod-schemas/SchemaViolationSchema"

export type SchemaViolation = z.infer<typeof SchemaViolationSchema>
