import * as grpc from "@grpc/grpc-js"
import * as protoLoader from "@grpc/proto-loader"
import Protobuf from "protobufjs"
import descriptor from "protobufjs/ext/descriptor"
import { GrpcSchemaError, schemaFromDescriptorSet, type GrpcSchema } from "./grpc_schema"

/**
 * The server reflection client, written against the reflection protocol itself:
 * the maintained client libraries speak only `v1alpha`, and servers are moving
 * to `v1`. The two differ in their package name alone, so one embedded copy of
 * the proto serves both. It is embedded as text rather than shipped as a file
 * so it survives bundling and asar packaging.
 */
const REFLECTION_PROTO = `
syntax = "proto3";
package grpc.reflection.VERSION;
service ServerReflection {
  rpc ServerReflectionInfo(stream ServerReflectionRequest) returns (stream ServerReflectionResponse);
}
message ServerReflectionRequest {
  string host = 1;
  oneof message_request {
    string file_by_filename = 3;
    string file_containing_symbol = 4;
    ExtensionRequest file_containing_extension = 5;
    string all_extension_numbers_of_type = 6;
    string list_services = 7;
  }
}
message ExtensionRequest { string containing_type = 1; int32 extension_number = 2; }
message ServerReflectionResponse {
  string valid_host = 1;
  ServerReflectionRequest original_request = 2;
  oneof message_response {
    FileDescriptorResponse file_descriptor_response = 4;
    ExtensionNumberResponse all_extension_numbers_response = 5;
    ListServiceResponse list_services_response = 6;
    ErrorResponse error_response = 7;
  }
}
message FileDescriptorResponse { repeated bytes file_descriptor_proto = 1; }
message ExtensionNumberResponse { string base_type_name = 1; repeated int32 extension_number = 2; }
message ListServiceResponse { repeated ServiceResponse service = 1; }
message ServiceResponse { string name = 1; }
message ErrorResponse { int32 error_code = 1; string error_message = 2; }
`

const VERSIONS = ["v1", "v1alpha"] as const
const MAX_FILES = 500
const REFLECTION_DEADLINE_MS = 10_000

interface ReflectionRequest {
  readonly listServices?: string
  readonly fileContainingSymbol?: string
  readonly fileByFilename?: string
}

interface ReflectionResponse {
  readonly listServicesResponse?: { readonly service: readonly { readonly name: string }[] }
  readonly fileDescriptorResponse?: { readonly fileDescriptorProto: readonly Uint8Array[] }
  readonly errorResponse?: { readonly errorCode: number; readonly errorMessage: string }
}

function reflectionMethod(version: (typeof VERSIONS)[number]): protoLoader.MethodDefinition<object, object> {
  const root = Protobuf.parse(REFLECTION_PROTO.replace("VERSION", version), { keepCase: false }).root
  const definition = protoLoader.fromJSON(root.toJSON(), { oneofs: true, defaults: true })
  const service = definition[`grpc.reflection.${version}.ServerReflection`] as protoLoader.ServiceDefinition
  return service["ServerReflectionInfo"]!
}

/** One reflection stream, asked one question at a time: the server answers in order. */
class ReflectionSession {
  private readonly stream: grpc.ClientDuplexStream<object, object>
  private readonly responses: ReflectionResponse[] = []
  private waiter: { resolve: (value: ReflectionResponse) => void; reject: (error: Error) => void } | undefined
  private failure: Error | undefined

  public constructor(client: grpc.Client, version: (typeof VERSIONS)[number]) {
    const method = reflectionMethod(version)
    this.stream = client.makeBidiStreamRequest(method.path, method.requestSerialize, method.responseDeserialize, undefined, {
      deadline: Date.now() + REFLECTION_DEADLINE_MS,
    })
    this.stream.on("data", (response: ReflectionResponse) => {
      if (this.waiter) {
        const { resolve } = this.waiter
        this.waiter = undefined
        resolve(response)
      } else {
        this.responses.push(response)
      }
    })
    this.stream.on("error", (error: Error) => this.fail(error))
    this.stream.on("end", () => this.fail(new Error("The server closed the reflection stream")))
  }

  private fail(error: Error): void {
    this.failure ??= error
    if (this.waiter) {
      const { reject } = this.waiter
      this.waiter = undefined
      reject(error)
    }
  }

  public ask(request: ReflectionRequest): Promise<ReflectionResponse> {
    return new Promise((resolve, reject) => {
      const queued = this.responses.shift()
      if (queued) return resolve(queued)
      if (this.failure) return reject(this.failure)
      this.waiter = { resolve, reject }
      this.stream.write(request)
    })
  }

  public close(): void {
    this.stream.removeAllListeners("data")
    this.stream.on("error", () => undefined)
    this.stream.cancel()
  }
}

function isReflectionService(name: string): boolean {
  return name.startsWith("grpc.reflection.")
}

/** Every file that defines `services`, and every file those import, as encoded `FileDescriptorProto`s. */
async function collectFiles(session: ReflectionSession): Promise<{ files: Map<string, Uint8Array>; services: string[] }> {
  const list = await session.ask({ listServices: "" })
  if (list.errorResponse) throw new GrpcSchemaError(`Reflection: ${list.errorResponse.errorMessage}`)
  const services = (list.listServicesResponse?.service ?? []).map((service) => service.name).filter((name) => !isReflectionService(name))
  const files = new Map<string, Uint8Array>()
  const dependencies: string[] = []
  const add = (response: ReflectionResponse): void => {
    for (const bytes of response.fileDescriptorResponse?.fileDescriptorProto ?? []) {
      const file = descriptor.FileDescriptorProto.decode(bytes) as unknown as { name: string; dependency: string[] }
      if (files.has(file.name)) continue
      if (files.size >= MAX_FILES) throw new GrpcSchemaError(`Reflection: more than ${MAX_FILES} files`)
      files.set(file.name, bytes)
      dependencies.push(...file.dependency)
    }
  }
  for (const service of services) {
    const response = await session.ask({ fileContainingSymbol: service })
    if (response.errorResponse) throw new GrpcSchemaError(`Reflection: ${service}: ${response.errorResponse.errorMessage}`)
    add(response)
  }
  for (let index = 0; index < dependencies.length; index += 1) {
    const name = dependencies[index]!
    if (files.has(name)) continue
    const response = await session.ask({ fileByFilename: name })
    // A server that cannot name a dependency (a well-known type it left out) is tolerated here:
    // building the schema reports the type that is then missing.
    if (!response.errorResponse) add(response)
  }
  return { files, services }
}

function descriptorSet(files: ReadonlyMap<string, Uint8Array>): Protobuf.Message {
  // A FileDescriptorSet is `repeated FileDescriptorProto file = 1`: each file is a length-delimited field 1.
  const writer = Protobuf.Writer.create()
  for (const bytes of files.values()) writer.uint32(10).bytes(bytes)
  return descriptor.FileDescriptorSet.decode(writer.finish())
}

/**
 * The schema a server describes through reflection, trying `v1` and then
 * `v1alpha`. `client` is a channel to the server; the caller closes it.
 */
export async function schemaFromReflection(client: grpc.Client): Promise<GrpcSchema> {
  let lastError: unknown
  for (const version of VERSIONS) {
    const session = new ReflectionSession(client, version)
    try {
      const { files } = await collectFiles(session)
      return schemaFromDescriptorSet(descriptorSet(files))
    } catch (error) {
      if (error instanceof GrpcSchemaError) throw error
      lastError = error
      const code = (error as { code?: unknown }).code
      // Only "this server does not speak this version" moves on to the next one.
      if (code !== grpc.status.UNIMPLEMENTED) break
    } finally {
      session.close()
    }
  }
  const detail = lastError instanceof Error ? lastError.message : String(lastError)
  throw new GrpcSchemaError(`Reflection failed: ${detail}`)
}
