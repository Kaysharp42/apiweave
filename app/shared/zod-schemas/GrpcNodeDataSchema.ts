import { z } from "zod"
import { AuthConfigSchema } from "./AuthConfigSchema"
import { KeyValuePairSchema } from "./KeyValuePairSchema"

/**
 * Inline `.proto` files, keyed by path (`"helloworld.proto"`,
 * `"protos/common.proto"`). Imports resolve within this map, so a workflow stays
 * portable in `.aweproject` exports and git — the schema source travels with the
 * node, not with the machine that authored it.
 */
export const GrpcProtoFilesSchema = z
  .record(z.string().min(1), z.string().min(1))
  .describe("Inline .proto files as a map from path to file content. Imports resolve within this map.")

/**
 * A unary gRPC call. `callType` is locked to `"unary"` for now; server
 * streaming extends this node later (C2).
 */
export const GrpcNodeDataSchema = z
  .object({
    callType: z.literal("unary").optional().describe('Only "unary" today; server streaming is a later extension.'),
    target: z.string().optional().describe('Address as "host:port", e.g. "localhost:50051". Placeholders are substituted.'),
    tls: z.boolean().optional().describe("Use a TLS connection (grpcs). CA, client certificate and verification come from Settings > Network."),
    sslVerify: z.boolean().optional().describe("Verify the TLS certificate chain (default true). Per-node opt-out for self-signed dev endpoints."),
    service: z.string().optional().describe('Fully-qualified service name, e.g. "helloworld.Greeter".'),
    method: z.string().optional().describe('RPC method name, e.g. "SayHello".'),
    message: z.string().optional().describe('The request message as JSON text, e.g. {"name": "Rex"}. Placeholders are substituted JSON-aware.'),
    metadata: z.array(KeyValuePairSchema).optional().describe("Metadata (headers) as {key, value} pairs. Values accept placeholders."),
    auth: AuthConfigSchema.optional().describe("Bearer and API-key credentials become metadata."),
    deadline: z.number().int().positive().max(3600).optional().describe("Call deadline in seconds. Defaults to 30."),
    schemaSource: z
      .enum(["reflection", "proto"])
      .optional()
      .describe('How the service definition is resolved: server reflection ("reflection"), or inline .proto text ("proto").'),
    protoFiles: GrpcProtoFilesSchema.optional().describe('Inline .proto files when schemaSource is "proto".'),
    continueOnFail: z.boolean().optional().describe("When true, a failed call lets the run continue down the outgoing edge instead of stopping the branch."),
    expectedStatus: z
      .string()
      .optional()
      .describe('The gRPC status code name this call is expected to return, e.g. "INVALID_ARGUMENT". The node passes on a match and fails otherwise — a non-OK code that is not expected fails the node. Omit for the default, where only OK passes.'),
    extractors: z.record(z.string(), z.string()).optional().describe('Captures values from the decoded response into workflow variables, e.g. {"id": "response.body.id"}.'),
  })
  .strict()
