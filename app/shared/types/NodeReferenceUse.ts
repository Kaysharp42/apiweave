import type { z } from "zod"
import type { NodeReferenceUseSchema } from "../zod-schemas/NodeReferenceUseSchema"

export type NodeReferenceUse = z.infer<typeof NodeReferenceUseSchema>
