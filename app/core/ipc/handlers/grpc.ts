import { z } from "zod"
import { GrpcDiscoveryResultSchema, GrpcProtoFilesSchema } from "@shared/zod-schemas"
import type { IpcRouter } from "../router"
import type { GrpcDiscoveryService } from "../../services/grpc_discovery_service"

const DiscoverInput = z
  .object({
    target: z.string().min(1).optional().describe('Server address as a literal "host:port" (reflection only).'),
    tls: z.boolean().optional(),
    sslVerify: z.boolean().optional(),
    schemaSource: z.enum(["reflection", "proto"]),
    protoFiles: GrpcProtoFilesSchema.optional(),
  })
  .strict()
  .refine((input) => input.schemaSource === "proto" || input.target !== undefined, { path: ["target"], message: "Reflection needs a target" })

/** gRPC schema discovery: reflection or inline .proto files in, services and methods out. Read-only. */
export function registerGrpcHandlers(router: IpcRouter, discovery: GrpcDiscoveryService): void {
  router.register("grpc", "discover", {
    input: DiscoverInput,
    output: GrpcDiscoveryResultSchema,
    handle: (input) =>
      discovery.discover({
        target: input.target ?? "",
        tls: input.tls ?? false,
        sslVerify: input.sslVerify ?? true,
        source: input.schemaSource === "proto" ? { kind: "proto", files: input.protoFiles ?? {} } : { kind: "reflection" },
      }),
  })
}
