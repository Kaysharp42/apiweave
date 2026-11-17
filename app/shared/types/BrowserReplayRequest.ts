import type { z } from "zod"
import type { BrowserReplayRequestSchema } from "../zod-schemas/BrowserReplayRequestSchema"

export type BrowserReplayRequest = z.infer<typeof BrowserReplayRequestSchema>
