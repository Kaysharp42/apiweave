import type { z } from "zod"
import type { BrowserInspectionSchema } from "../zod-schemas/BrowserInspectionSchema"

export type BrowserInspection = z.infer<typeof BrowserInspectionSchema>
