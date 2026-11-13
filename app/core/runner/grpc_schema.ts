import * as protoLoader from "@grpc/proto-loader"
import Protobuf from "protobufjs"
import type { GrpcDiscoveryResult } from "@shared/types/GrpcDiscoveryResult"

/** A schema that could not be loaded, or a method that cannot be called. The message is shown to the user. */
export class GrpcSchemaError extends Error {
  public override readonly name = "GrpcSchemaError"
}

/**
 * Field names stay as written in the `.proto` file (`keepCase`), int64 values are
 * strings, enums are names and bytes are base64: the JSON a call sends and
 * receives is the same everywhere, whichever way the schema was obtained.
 */
export const GRPC_LOADER_OPTIONS: protoLoader.Options = {
  keepCase: true,
  longs: String,
  enums: String,
  bytes: String,
  defaults: true,
  oneofs: true,
  json: true,
}

/** A resolved schema: the protobuf reflection tree, and the call definitions grpc-js needs. */
export interface GrpcSchema {
  readonly root: Protobuf.Root
  readonly definition: protoLoader.PackageDefinition
}

const MAX_SKELETON_DEPTH = 4
const MAX_SERVICES = 200

function buildSchema(root: Protobuf.Root): GrpcSchema {
  try {
    root.resolveAll()
    return { root, definition: protoLoader.fromJSON(root.toJSON(), GRPC_LOADER_OPTIONS) }
  } catch (error) {
    throw new GrpcSchemaError(`Invalid schema: ${error instanceof Error ? error.message : String(error)}`)
  }
}

/**
 * A descriptor writes `map<K, V>` as a repeated field of a synthetic entry
 * message. Put the map field back, so a map is JSON `{key: value}` here as it is
 * in a schema parsed from `.proto` text.
 */
function restoreMapFields(root: Protobuf.Root, namespace: Protobuf.NamespaceBase): void {
  for (const nested of namespace.nestedArray) {
    if (nested instanceof Protobuf.Type) {
      for (const field of nested.fieldsArray) {
        if (!field.repeated) continue
        const entry = root.lookup(field.type)
        if (!(entry instanceof Protobuf.Type) || !isMapEntry(entry)) continue
        nested.remove(field)
        nested.add(new Protobuf.MapField(field.name, field.id, entry.fields["key"]!.type, entry.fields["value"]!.type))
        entry.parent?.remove(entry)
      }
    }
    if (nested instanceof Protobuf.Namespace) restoreMapFields(root, nested)
  }
}

/** A schema from a reflection `FileDescriptorSet`. */
export function schemaFromDescriptorSet(set: Protobuf.Message): GrpcSchema {
  try {
    const root = Protobuf.Root.fromDescriptor(set as never)
    restoreMapFields(root, root)
    return buildSchema(root)
  } catch (error) {
    if (error instanceof GrpcSchemaError) throw error
    throw new GrpcSchemaError(`Invalid schema: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "")
}

/**
 * A schema from `.proto` text held in memory, as a map from path to content.
 * Imports resolve within the map; Google's well-known types (`google/protobuf/*`)
 * are built in. Nothing is read from disk.
 */
export function schemaFromProtoFiles(files: Readonly<Record<string, string>>): GrpcSchema {
  const entries = Object.entries(files).map(([path, text]) => [normalizePath(path), text] as const)
  if (entries.length === 0) throw new GrpcSchemaError("No .proto files: add at least one")
  const known = new Set(entries.map(([path]) => path))
  const root = new Protobuf.Root()
  const wellKnown = new Set<string>()
  for (const [path, text] of entries) {
    let imports: string[]
    try {
      const parsed = Protobuf.parse(text, root, { keepCase: true })
      imports = [...(parsed.imports ?? []), ...(parsed.weakImports ?? [])]
    } catch (error) {
      throw new GrpcSchemaError(`${path}: ${error instanceof Error ? error.message : String(error)}`)
    }
    for (const imported of imports.map(normalizePath)) {
      if (known.has(imported) || wellKnown.has(imported)) continue
      const common = Protobuf.common.get(imported) as { nested?: Record<string, Protobuf.AnyNestedObject> } | null
      if (common?.nested === undefined) throw new GrpcSchemaError(`${path}: imported file "${imported}" is not among the .proto files`)
      root.addJSON(common.nested)
      wellKnown.add(imported)
    }
  }
  return buildSchema(root)
}

function services(root: Protobuf.Root): Protobuf.Service[] {
  const found: Protobuf.Service[] = []
  const visit = (namespace: Protobuf.NamespaceBase): void => {
    for (const nested of namespace.nestedArray) {
      if (nested instanceof Protobuf.Service) found.push(nested)
      else if (nested instanceof Protobuf.Namespace) visit(nested)
    }
  }
  visit(root)
  return found
}

function bareName(type: Protobuf.ReflectionObject): string {
  return type.fullName.replace(/^\./, "")
}

/** A schema built from descriptors holds a map as a repeated entry message rather than a map field. */
function isMapEntry(type: Protobuf.Type): boolean {
  return type.options?.["map_entry"] === true || type.options?.["mapEntry"] === true
}

function skeletonValue(field: Protobuf.Field, depth: number, seen: readonly Protobuf.Type[]): unknown {
  const resolved = field.resolvedType
  if (field.map || (resolved instanceof Protobuf.Type && isMapEntry(resolved))) return {}
  if (field.repeated) return []
  if (resolved instanceof Protobuf.Enum) return Object.keys(resolved.values)[0] ?? 0
  if (resolved instanceof Protobuf.Type) return skeleton(resolved, depth + 1, seen)
  switch (field.type) {
    case "string":
    case "bytes":
      return ""
    case "bool":
      return false
    case "int64":
    case "uint64":
    case "sint64":
    case "fixed64":
    case "sfixed64":
      return "0"
    default:
      return 0
  }
}

function skeleton(type: Protobuf.Type, depth: number, seen: readonly Protobuf.Type[]): Record<string, unknown> {
  // A message that contains itself, or nests deeper than a form would ever use, ends as {}.
  if (depth > MAX_SKELETON_DEPTH || seen.includes(type)) return {}
  const result: Record<string, unknown> = {}
  for (const field of [...type.fieldsArray].sort((a, b) => a.id - b.id)) {
    field.resolve()
    result[field.name] = skeletonValue(field, depth, [...seen, type])
  }
  return result
}

/** Every service and method in the schema, with a request skeleton for each method. */
export function describeSchema(schema: GrpcSchema): GrpcDiscoveryResult {
  return {
    services: services(schema.root)
      .slice(0, MAX_SERVICES)
      .map((service) => ({
        name: bareName(service),
        methods: service.methodsArray.map((method) => {
          method.resolve()
          const request = method.resolvedRequestType
          return {
            name: method.name,
            requestType: request ? bareName(request) : method.requestType,
            responseType: method.resolvedResponseType ? bareName(method.resolvedResponseType) : method.responseType,
            requestStreaming: method.requestStream === true,
            responseStreaming: method.responseStream === true,
            requestSkeleton: JSON.stringify(request ? skeleton(request, 0, []) : {}, null, 2),
          }
        }),
      })),
  }
}

/** The call definition of a unary method; a missing service or method, or a streaming one, is a {@link GrpcSchemaError}. */
export function unaryMethod(schema: GrpcSchema, service: string, method: string): protoLoader.MethodDefinition<object, object> {
  const serviceDefinition = schema.definition[service]
  if (serviceDefinition === undefined || "format" in serviceDefinition) {
    throw new GrpcSchemaError(`Service "${service}" is not in the schema`)
  }
  const definition = (serviceDefinition as protoLoader.ServiceDefinition)[method]
  if (definition === undefined) throw new GrpcSchemaError(`Method "${method}" is not in service "${service}"`)
  if (definition.requestStream || definition.responseStream) {
    throw new GrpcSchemaError(`${service}/${method} is a streaming method; only unary calls are supported`)
  }
  return definition
}
