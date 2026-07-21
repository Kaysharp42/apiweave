import type { z } from "zod"
import type { MergeNodeDataSchema } from "../zod-schemas/MergeNodeDataSchema"

export type MergeNodeData = z.infer<typeof MergeNodeDataSchema>
