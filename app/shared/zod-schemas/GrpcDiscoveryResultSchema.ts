import { z } from "zod"

/** One RPC method discovered from a gRPC service. */
export const GrpcMethodInfoSchema = z
  .object({
    name: z.string(),
    requestType: z.string(),
    responseType: z.string(),
    requestStreaming: z.boolean(),
    responseStreaming: z.boolean(),
    /** A JSON skeleton for the request message, generated from its descriptor. */
    requestSkeleton: z.string(),
  })
  .strict()

/** One gRPC service and the methods it exposes. */
export const GrpcServiceInfoSchema = z
  .object({
    name: z.string(),
    methods: z.array(GrpcMethodInfoSchema),
  })
  .strict()

/** The services and methods discovered from reflection or inline .proto files. */
export const GrpcDiscoveryResultSchema = z
  .object({
    services: z.array(GrpcServiceInfoSchema),
  })
  .strict()
