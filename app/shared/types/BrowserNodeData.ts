import type { z } from "zod"
import type { BrowserNodeDataSchema } from "../zod-schemas/BrowserNodeDataSchema"

export type BrowserNodeData = z.infer<typeof BrowserNodeDataSchema>
