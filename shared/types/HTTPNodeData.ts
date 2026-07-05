import type { z } from "zod"
import type { HTTPNodeDataSchema } from "../zod-schemas/HTTPNodeDataSchema"

export type HTTPNodeData = z.infer<typeof HTTPNodeDataSchema>
