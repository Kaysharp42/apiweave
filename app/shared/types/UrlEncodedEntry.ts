import type { z } from "zod"
import type { UrlEncodedEntrySchema } from "../zod-schemas/UrlEncodedEntrySchema"

export type UrlEncodedEntry = z.infer<typeof UrlEncodedEntrySchema>
