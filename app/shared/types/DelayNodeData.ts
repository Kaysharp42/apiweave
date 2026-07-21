import type { z } from "zod"
import type { DelayNodeDataSchema } from "../zod-schemas/DelayNodeDataSchema"

export type DelayNodeData = z.infer<typeof DelayNodeDataSchema>
