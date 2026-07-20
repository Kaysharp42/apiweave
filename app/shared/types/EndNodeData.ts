import type { z } from "zod"
import type { EndNodeDataSchema } from "../zod-schemas/EndNodeDataSchema"

export type EndNodeData = z.infer<typeof EndNodeDataSchema>
