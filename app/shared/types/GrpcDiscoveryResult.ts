import type { z } from "zod"
import type { GrpcDiscoveryResultSchema } from "../zod-schemas/GrpcDiscoveryResultSchema"

export type GrpcMethodInfo = z.infer<typeof GrpcDiscoveryResultSchema>["services"][number]["methods"][number]
export type GrpcServiceInfo = z.infer<typeof GrpcDiscoveryResultSchema>["services"][number]
export type GrpcDiscoveryResult = z.infer<typeof GrpcDiscoveryResultSchema>
