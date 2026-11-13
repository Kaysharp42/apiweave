import { createSecureContext, type ConnectionOptions } from "node:tls"
import * as grpc from "@grpc/grpc-js"
import { schemaFromReflection } from "./grpc_reflection"
import { GrpcSchemaError, schemaFromProtoFiles, unaryMethod, type GrpcSchema } from "./grpc_schema"

/** Where a call goes and how its channel is secured. */
export interface GrpcConnection {
  /** `host:port`. */
  readonly target: string
  readonly tls: boolean
  readonly sslVerify: boolean
  /** The network settings' CAs and client certificate for `https://<target>`; see `SafeHttp.tlsOptionsFor`. */
  readonly tlsOptionsFor: (url: string, rejectUnauthorized: boolean) => ConnectionOptions
}

/** Where the service definition comes from. */
export type GrpcSchemaSource =
  | { readonly kind: "reflection" }
  | { readonly kind: "proto"; readonly files: Readonly<Record<string, string>> }

export interface GrpcUnaryRequest {
  readonly connection: GrpcConnection
  readonly schema: GrpcSchema
  readonly service: string
  readonly method: string
  readonly message: unknown
  /** Lowercase keys; keys ending in `-bin` are sent as binary from base64. */
  readonly metadata: Readonly<Record<string, string>>
  readonly deadlineMs: number
  readonly signal?: AbortSignal | undefined
}

export interface GrpcUnaryResponse {
  readonly code: number
  readonly codeName: string
  readonly statusMessage: string
  /** The decoded message; undefined when the call did not succeed. */
  readonly body: unknown
  readonly headers: Record<string, string>
  readonly trailers: Record<string, string>
}

const MAX_METADATA_ENTRIES = 100

function createClient(connection: GrpcConnection): grpc.Client {
  return new grpc.Client(connection.target, channelCredentials(connection), {
    // Retries would send a non-idempotent call twice behind the test's back.
    "grpc.enable_retries": 0,
  })
}

function channelCredentials(connection: GrpcConnection): grpc.ChannelCredentials {
  if (!connection.tls) return grpc.credentials.createInsecure()
  const { ca, cert, key, pfx, passphrase } = connection.tlsOptionsFor(`https://${connection.target}`, connection.sslVerify)
  const context = createSecureContext({
    ...(ca === undefined ? {} : { ca }),
    ...(cert === undefined ? {} : { cert }),
    ...(key === undefined ? {} : { key }),
    ...(pfx === undefined ? {} : { pfx }),
    ...(passphrase === undefined ? {} : { passphrase }),
  })
  return grpc.credentials.createFromSecureContext(context, { rejectUnauthorized: connection.sslVerify })
}

/** The schema a node's source describes: parsed in memory for `proto`, fetched from the server for `reflection`. */
export async function loadGrpcSchema(connection: GrpcConnection, source: GrpcSchemaSource): Promise<GrpcSchema> {
  if (source.kind === "proto") return schemaFromProtoFiles(source.files)
  const client = createClient(connection)
  try {
    return await schemaFromReflection(client)
  } finally {
    client.close()
  }
}

function toMetadata(entries: Readonly<Record<string, string>>): grpc.Metadata {
  const metadata = new grpc.Metadata()
  for (const [key, value] of Object.entries(entries)) {
    try {
      if (key.endsWith("-bin")) metadata.add(key, Buffer.from(value, "base64"))
      else metadata.add(key, value)
    } catch (error) {
      throw new GrpcSchemaError(`Invalid metadata "${key}": ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  return metadata
}

function fromMetadata(metadata: grpc.Metadata | undefined): Record<string, string> {
  const record: Record<string, string> = {}
  if (metadata === undefined) return record
  for (const [key, values] of Object.entries(metadata.toJSON()).slice(0, MAX_METADATA_ENTRIES)) {
    record[key] = values.map((value) => (typeof value === "string" ? value : value.toString("base64"))).join(", ")
  }
  return record
}

/** Makes one unary call. Resolves with whatever status the server answered with — a non-OK status is a result, not a throw. */
export async function callUnary(request: GrpcUnaryRequest): Promise<GrpcUnaryResponse> {
  const definition = unaryMethod(request.schema, request.service, request.method)
  const metadata = toMetadata(request.metadata)
  try {
    // A message that does not fit the request type is the author's mistake: report it before connecting.
    definition.requestSerialize(request.message as object)
  } catch (error) {
    throw new GrpcSchemaError(`The message does not match ${definition.requestType.type.name}: ${error instanceof Error ? error.message : String(error)}`)
  }
  const client = createClient(request.connection)
  try {
    return await new Promise<GrpcUnaryResponse>((resolve) => {
      let headers: grpc.Metadata | undefined
      let body: unknown
      const call = client.makeUnaryRequest(
        definition.path,
        definition.requestSerialize,
        definition.responseDeserialize,
        request.message as object,
        metadata,
        { deadline: Date.now() + request.deadlineMs },
        (_error, value) => {
          body = value
        },
      )
      call.on("metadata", (received) => {
        headers = received
      })
      call.on("status", (status) => {
        // Callback and status fire back to back; deliver after the callback has stored the message.
        setImmediate(() =>
          resolve({
            code: status.code,
            codeName: grpc.status[status.code] ?? String(status.code),
            statusMessage: status.details,
            body: status.code === grpc.status.OK ? body : undefined,
            headers: fromMetadata(headers),
            trailers: fromMetadata(status.metadata),
          }),
        )
      })
      const onAbort = (): void => call.cancel()
      if (request.signal?.aborted) onAbort()
      request.signal?.addEventListener("abort", onAbort, { once: true })
      call.on("status", () => request.signal?.removeEventListener("abort", onAbort))
    })
  } finally {
    client.close()
  }
}
