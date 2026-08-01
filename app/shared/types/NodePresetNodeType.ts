import type { z } from "zod"
import type { NodePresetNodeTypeSchema } from "../zod-schemas/NodePresetNodeTypeSchema"

export type NodePresetNodeType = z.infer<typeof NodePresetNodeTypeSchema>
