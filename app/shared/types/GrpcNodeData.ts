import type { z } from "zod"
import type { GrpcNodeDataSchema } from "../zod-schemas/GrpcNodeDataSchema"

export type GrpcNodeData = z.infer<typeof GrpcNodeDataSchema>
