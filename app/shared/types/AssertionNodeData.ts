import type { z } from "zod"
import type { AssertionNodeDataSchema } from "../zod-schemas/AssertionNodeDataSchema"

export type AssertionNodeData = z.infer<typeof AssertionNodeDataSchema>
