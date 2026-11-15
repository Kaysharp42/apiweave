import type { z } from "zod"
import type { BrowserRecordingRequestSchema } from "../zod-schemas/BrowserRecordingRequestSchema"

export type BrowserRecordingRequest = z.infer<typeof BrowserRecordingRequestSchema>
