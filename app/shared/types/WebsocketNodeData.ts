import type { z } from "zod"
import type { WebsocketNodeDataSchema } from "../zod-schemas/WebsocketNodeDataSchema"

export type WebsocketNodeData = z.infer<typeof WebsocketNodeDataSchema>
