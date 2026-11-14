import type { z } from "zod"
import type { GrpcDiscoveryResultSchema } from "../zod-schemas/GrpcDiscoveryResultSchema"

export type GrpcDiscoveryResult = z.infer<typeof GrpcDiscoveryResultSchema>
