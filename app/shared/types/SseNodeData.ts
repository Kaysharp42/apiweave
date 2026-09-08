import type { z } from "zod"
import type { SseNodeDataSchema } from "../zod-schemas/SseNodeDataSchema"

export type SseNodeData = z.infer<typeof SseNodeDataSchema>
