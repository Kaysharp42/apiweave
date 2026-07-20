import type { z } from "zod"
import type { StartNodeDataSchema } from "../zod-schemas/StartNodeDataSchema"

export type StartNodeData = z.infer<typeof StartNodeDataSchema>
