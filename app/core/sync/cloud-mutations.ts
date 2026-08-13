import type { Collection } from "@shared/types/Collection"
import type { Environment } from "@shared/types/Environment"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Workflow } from "@shared/types/Workflow"
import type { WorkflowNode } from "@shared/types/WorkflowNode"
import type { Workspace } from "@shared/types/Workspace"
import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"
import {
  assertNoSecretValues,
  containsCredentialMaterial,
  isCredentialFreeReference,
  isEmptySyncValue,
  isSyncSensitiveKey,
} from "../services/secret_utils"
import type { SyncProvider } from "./SyncProvider"

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export function sanitizeCloudSnapshotPayload(payload: Uint8Array): Uint8Array {
  if (payload.length === 0) {
    return payload
  }
  const parsed = JSON.parse(textDecoder.decode(payload)) as unknown
  const sanitized = sanitizeSnapshotValue(parsed)
  assertNoSecretValues(sanitized)
  return textEncoder.encode(JSON.stringify(sanitized))
}

export function recordWorkspaceUpsert(syncProvider: SyncProvider, workspace: Workspace): void {
  recordUpsert(syncProvider, {
    workspaceId: workspace.workspaceId,
    kind: RecordKind.WORKSPACE,
    recordId: workspace.workspaceId,
    expectedRev: expectedRevForUpsert(workspace.rev),
    payload: {
      workspaceId: workspace.workspaceId,
      slug: workspace.slug,
      name: workspace.name,
      description: workspace.description,
      isPersonal: workspace.isPersonal,
      origin: workspace.origin,
      syncMode: workspace.syncMode,
      rev: workspace.rev,
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    },
  })
}

export function recordWorkspaceTombstone(syncProvider: SyncProvider, workspace: Workspace): void {
  recordTombstone(syncProvider, workspace.workspaceId, RecordKind.WORKSPACE, workspace.workspaceId, workspace.rev)
}

export function recordCollectionUpsert(syncProvider: SyncProvider, collection: Collection): void {
  recordUpsert(syncProvider, {
    workspaceId: collection.workspaceId,
    kind: RecordKind.PROJECT,
    recordId: collection.collectionId,
    expectedRev: expectedRevForUpsert(collection.rev),
    payload: {
      collectionId: collection.collectionId,
      workspaceId: collection.workspaceId,
      projectId: collection.projectId ?? collection.collectionId,
      name: collection.name,
      description: collection.description,
      color: collection.color,
      workflowCount: collection.workflowCount,
      workflowOrder: collection.workflowOrder.map((item) => item.workflowId),
      workflowOrderItems: collection.workflowOrder,
      continueOnFail: collection.continueOnFail,
      rev: collection.rev,
      createdAt: collection.createdAt,
      updatedAt: collection.updatedAt,
    },
  })
}

export function recordCollectionTombstone(syncProvider: SyncProvider, collection: Collection): void {
  recordTombstone(syncProvider, collection.workspaceId, RecordKind.PROJECT, collection.collectionId, collection.rev)
}

export function recordWorkflowUpsert(syncProvider: SyncProvider, workflow: Workflow): void {
  recordUpsert(syncProvider, {
    workspaceId: workflow.workspaceId,
    kind: RecordKind.WORKFLOW,
    recordId: workflow.workflowId,
    expectedRev: expectedRevForUpsert(workflow.rev),
    payload: {
      workflowId: workflow.workflowId,
      workspaceId: workflow.workspaceId,
      name: workflow.name,
      description: workflow.description,
      nodes: workflow.nodes.map(sanitizeWorkflowNode),
      edges: workflow.edges,
      variables: sanitizeVariables(workflow.variables),
      tags: workflow.tags,
      collectionId: workflow.collectionId,
      selectedEnvironmentId: workflow.selectedEnvironmentId,
      nodeTemplates: workflow.nodeTemplates.map((template) => sanitizeSnapshotValue(template)),
      rev: workflow.rev,
      createdAt: workflow.createdAt,
      updatedAt: workflow.updatedAt,
    },
  })
}

export function recordWorkflowTombstone(syncProvider: SyncProvider, workflow: Workflow): void {
  recordTombstone(syncProvider, workflow.workspaceId, RecordKind.WORKFLOW, workflow.workflowId, workflow.rev)
}

export function recordEnvironmentUpsert(syncProvider: SyncProvider, environment: Environment): void {
  recordUpsert(syncProvider, {
    workspaceId: environment.workspaceId,
    kind: RecordKind.ENVIRONMENT,
    recordId: environment.environmentId,
    expectedRev: expectedRevForUpsert(environment.rev),
    // `baseEnvironmentId` (environment inheritance) is deliberately ABSENT from
    // this payload: the Cloud schema has no such field yet, so pushing it would
    // fail validation server-side. It stays local until a follow-up pass adds
    // it to `apiweave-proto` + `apiweave-cloud`. Until then a synced
    // environment loses its inheritance link on the receiving machine — the
    // same open question `.awecollection` import has for dangling references.
    payload: {
      environmentId: environment.environmentId,
      workspaceId: environment.workspaceId,
      name: environment.name,
      description: environment.description,
      swaggerDocUrl: environment.swaggerDocUrl === undefined
        ? undefined
        : sanitizeUrl(environment.swaggerDocUrl),
      variables: sanitizeVariables(environment.variables),
      secrets: secretReferencesOnly(environment.secrets, environment.scopeType, environment.scopeId),
      isDefault: environment.isDefault,
      scopeType: environment.scopeType,
      scopeId: environment.scopeId,
      rev: environment.rev,
      createdAt: environment.createdAt,
      updatedAt: environment.updatedAt,
    },
  })
}

export function recordEnvironmentTombstone(syncProvider: SyncProvider, environment: Environment): void {
  recordTombstone(syncProvider, environment.workspaceId, RecordKind.ENVIRONMENT, environment.environmentId, environment.rev)
}

function recordUpsert(
  syncProvider: SyncProvider,
  input: {
    readonly workspaceId: string
    readonly kind: RecordKind
    readonly recordId: string
    readonly expectedRev: number
    readonly payload: Record<string, unknown>
  },
): void {
  const payload = withheldCredentialStrings(input.payload) as Record<string, unknown>
  assertNoSecretValues(payload as JsonValue)
  syncProvider.recordMutation({
    workspaceId: input.workspaceId,
    kind: input.kind,
    recordId: input.recordId,
    expectedRev: input.expectedRev,
    op: ChangeOp.UPSERT,
    payload: textEncoder.encode(JSON.stringify(payload)),
  })
}

// A last pass over every string in the payload, whatever record kind it is.
// The fields above get structural treatment (bodies, headers, auth, urls), but
// the pull-side validator scans EVERY string it receives — so a node label, a
// workflow description, or an edge label holding a pasted `Authorization:
// Bearer ...` example would push fine, be stored by the server (which inspects
// only node configs, variables and templates), and then throw on every other
// device's pull, which stops advancing its cursor and stops syncing at all.
function withheldCredentialStrings(value: unknown): unknown {
  if (typeof value === "string") {
    return containsCredentialMaterial(value) ? "" : value
  }
  if (Array.isArray(value)) {
    return value.map(withheldCredentialStrings)
  }
  if (isRecord(value)) {
    const scanned: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      scanned[key] = withheldCredentialStrings(nested)
    }
    return scanned
  }
  return value
}

function recordTombstone(
  syncProvider: SyncProvider,
  workspaceId: string,
  kind: RecordKind,
  recordId: string,
  expectedRev: number,
): void {
  syncProvider.recordMutation({
    workspaceId,
    kind,
    recordId,
    expectedRev,
    op: ChangeOp.TOMBSTONE,
    payload: null,
  })
}

function expectedRevForUpsert(currentRev: number): number {
  return Math.max(0, currentRev - 1)
}

function sanitizeWorkflowNode(node: WorkflowNode): JsonValue {
  const copy = { ...node } as Record<string, unknown>
  const config = copy["config"]
  if (isRecord(config)) {
    copy["config"] = sanitizeConfig(config)
  }
  return copy as JsonValue
}

function sanitizeConfig(config: Record<string, unknown>): JsonValue {
  const sanitized: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(config)) {
    if (isSyncSensitiveKey(key)) {
      continue
    }
    if (key === "body" && typeof value === "string") {
      sanitized[key] = sanitizeBodyText(value)
      continue
    }
    if (key === "url" && typeof value === "string") {
      sanitized[key] = sanitizeUrl(value)
      continue
    }
    if (key === "cookies" && Array.isArray(value)) {
      sanitized[key] = sanitizeKeyValueItems(value, true)
      continue
    }
    if (isKeyValueConfigField(key) && Array.isArray(value)) {
      sanitized[key] = sanitizeKeyValueItems(value, false)
      continue
    }
    if (key === "auth" && isRecord(value)) {
      sanitized[key] = sanitizeAuthConfig(value)
      continue
    }
    if (key === "fileUploads" && Array.isArray(value)) {
      sanitized[key] = sanitizeFileUploads(value)
      continue
    }
    // Every remaining string is inspected too (`inspectStringValues`): the
    // server scans *all* config strings for credential material, so a field
    // this sanitizer skips — an assertion's expected value, a script, a
    // GraphQL document — is a field whose workflow silently stops syncing.
    sanitized[key] = sanitizeValue(value, true)
  }
  return sanitized
}

// A `variable` reference just names a workflow variable, not file content, so
// it passes through; base64/path payloads must never leave the machine.
function sanitizeFileUploads(items: readonly unknown[]): JsonValue[] {
  return items.map((item) => {
    if (!isRecord(item) || item["type"] === "variable") return sanitizeValue(item)
    const sanitized = sanitizeValue(item) as Record<string, JsonValue>
    return { ...sanitized, value: "" }
  })
}

// Auth secrets live under generic leaf names (`token`, `password`, `value`) that
// only make sense as secrets given their parent (`bearer`, `basic`, `apiKey`).
// Key-name/value-heuristic redaction elsewhere in this file can't see that
// context, so these three paths are redacted unconditionally, by structure —
// except `{{...}}` references, which name a slot rather than carry a credential.
//
// Each leaf is read from the RAW `auth`, not from the sanitized copy: generic
// `sanitizeValue` drops sensitive key names outright, and `bearer.token`,
// `basic.password` and `apiKey` itself are all sensitive names. Reading the
// copy would mean every leaf was already gone — a reference could never be
// preserved, and the whole `apiKey` block (its header name and location, not
// just its value) would vanish from the payload.
function sanitizeAuthConfig(auth: Record<string, unknown>): JsonValue {
  const sanitized = sanitizeValue(auth, true) as Record<string, JsonValue>
  for (const [parent, leaf] of [["bearer", "token"], ["basic", "password"], ["apiKey", "value"]] as const) {
    const raw = auth[parent]
    if (!isRecord(raw)) continue
    const withoutLeaf = { ...raw }
    delete withoutLeaf[leaf]
    const rest = sanitizeValue(withoutLeaf, true) as Record<string, JsonValue>
    sanitized[parent] = { ...rest, [leaf]: blankUnlessReference(raw[leaf]) }
  }
  return sanitized
}

function sanitizeVariables(variables: Record<string, JsonValue>): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(variables)) {
    if (!isSyncSensitiveKey(key)) {
      sanitized[key] = sanitizeValue(value, true)
    }
  }
  return sanitized
}

function sanitizeValue(value: unknown, inspectStringValues = false): JsonValue {
  if (Array.isArray(value)) {
    const sanitized: JsonValue[] = []
    for (const item of value) {
      if (isSecretKeyValueItem(item)) {
        continue
      }
      sanitized.push(sanitizeValue(item, inspectStringValues))
    }
    return sanitized
  }
  if (isRecord(value)) {
    const sanitized: Record<string, JsonValue> = {}
    for (const [key, nested] of Object.entries(value)) {
      if (!isSyncSensitiveKey(key)) {
        sanitized[key] = sanitizeValue(nested, inspectStringValues)
      }
    }
    return sanitized
  }
  if (typeof value === "string") {
    return inspectStringValues && containsCredentialMaterial(value) ? "" : value
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value
  }
  return null
}

function sanitizeSnapshotValue(value: unknown): JsonValue {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !isSecretKeyValueItem(item))
      .map((item) => sanitizeSnapshotValue(item))
  }
  if (isRecord(value)) {
    const sanitized: Record<string, JsonValue> = {}
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      if (isSyncSensitiveKey(nestedKey)) {
        continue
      }
      if (nestedKey === "body" && typeof nestedValue === "string") {
        sanitized[nestedKey] = sanitizeBodyText(nestedValue)
      } else if (nestedKey === "url" && typeof nestedValue === "string") {
        sanitized[nestedKey] = sanitizeUrl(nestedValue)
      } else if (nestedKey === "cookies" && Array.isArray(nestedValue)) {
        sanitized[nestedKey] = sanitizeKeyValueItems(nestedValue, true)
      } else if (isKeyValueConfigField(nestedKey) && Array.isArray(nestedValue)) {
        sanitized[nestedKey] = sanitizeKeyValueItems(nestedValue, false)
      } else if (nestedKey === "auth" && isRecord(nestedValue)) {
        sanitized[nestedKey] = sanitizeAuthConfig(nestedValue)
      } else if (nestedKey === "fileUploads" && Array.isArray(nestedValue)) {
        sanitized[nestedKey] = sanitizeFileUploads(nestedValue)
      } else {
        sanitized[nestedKey] = sanitizeSnapshotValue(nestedValue)
      }
    }
    return sanitized
  }
  if (typeof value === "string") {
    return containsCredentialMaterial(value) ? "" : value
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value
  }
  return null
}

function isSecretKeyValueItem(value: unknown): boolean {
  if (!isRecord(value)) {
    return false
  }
  const key = value["key"]
  return typeof key === "string" && isSyncSensitiveKey(key)
}

function sanitizeKeyValueItems(values: readonly unknown[], redactAllValues: boolean): JsonValue[] {
  const sanitized: JsonValue[] = []
  for (const value of values) {
    if (!isRecord(value)) {
      sanitized.push(sanitizeValue(value))
      continue
    }
    const item = sanitizeValue(value)
    const key = value["key"]
    const sensitiveKey = typeof key === "string" && isSyncSensitiveKey(key)
    if (isRecord(item)) {
      const itemValue = item["value"]
      const withheld = redactAllValues || sensitiveKey
        ? !isCredentialFreeReference(itemValue)
        : typeof itemValue === "string" && containsCredentialMaterial(itemValue)
      if (withheld && !isEmptySyncValue(itemValue)) {
        item["value"] = ""
      }
    }
    sanitized.push(item)
  }
  return sanitized
}

function isKeyValueConfigField(key: string): boolean {
  return key === "headers"
    || key === "queryParams"
    || key === "pathVariables"
    || key === "formDataEntries"
    || key === "urlEncodedEntries"
}

function blankUnlessReference(value: unknown): JsonValue {
  return isCredentialFreeReference(value) ? value as string : ""
}

// Redact a request body leaf-by-leaf instead of blanking it wholesale: the body
// is workflow config and must round-trip, but no credential-shaped leaf may
// leave the machine. JSON bodies are walked structurally; a non-JSON body is
// blanked whole only when it carries credential material. Credential-free
// `{{...}}` references survive, and when nothing was redacted the original
// string returns verbatim so the sanitizer never introduces spurious diffs.
function sanitizeBodyText(body: string): string {
  let parsed: unknown
  try {
    parsed = JSON.parse(body)
  } catch {
    return containsCredentialMaterial(body) ? "" : body
  }
  let redacted = false
  const blank = (): JsonValue => {
    redacted = true
    return ""
  }
  // In a body, a sensitive key name withholds its WHOLE value rather than its
  // string leaves. The validators are content to walk a container and judge its
  // leaves by name, which is what lets `auth.apiKey` sync; but inside a request
  // body there is no schema to lean on, so an opaque credential one level down
  // (`{"apiKey":{"v":"..."}}`) would have no leaf name to catch it.
  const walk = (value: unknown, keyName: string | null): JsonValue => {
    const sensitive = keyName !== null && isSyncSensitiveKey(keyName)
    if (sensitive) {
      if (isEmptySyncValue(value)) return value as JsonValue
      return isCredentialFreeReference(value) ? value as string : blank()
    }
    if (Array.isArray(value)) {
      return value.map((item) => walk(item, null))
    }
    if (isRecord(value)) {
      const out: Record<string, JsonValue> = {}
      // Mirror the validators' `{key, value}` pair semantics: the sensitivity
      // of a pair lives in its sibling `key`, not in the literal name `value`.
      const pairKey = value["key"]
      const pairSensitive = typeof pairKey === "string" && isSyncSensitiveKey(pairKey)
      for (const [key, child] of Object.entries(value)) {
        out[key] = pairSensitive && key === "value"
          ? (isEmptySyncValue(child) || isCredentialFreeReference(child) ? child as JsonValue : blank())
          : walk(child, key)
      }
      return out
    }
    if (typeof value === "string") {
      return containsCredentialMaterial(value) ? blank() : value
    }
    return value as JsonValue
  }
  const sanitized = walk(parsed, null)
  return redacted ? JSON.stringify(sanitized, null, 2) : body
}

function sanitizeUrl(value: string | null): string | null {
  if (value === null) {
    return null
  }
  try {
    const url = new URL(value)
    url.username = ""
    url.password = ""
    for (const [key, queryValue] of url.searchParams) {
      if (isSyncSensitiveKey(key) || containsCredentialMaterial(queryValue)) {
        url.searchParams.set(key, "")
      }
    }
    // OAuth implicit-flow tokens travel in the fragment (`#access_token=...`),
    // and path segments can embed tokens too (`/tokens/<secret>`); neither is
    // reachable via searchParams.
    if (url.hash) url.hash = ""
    url.pathname = url.pathname
      .split("/")
      .map((segment) => (containsCredentialMaterial(segment) ? "" : segment))
      .join("/")
    return url.toString()
  } catch {
    return containsCredentialMaterial(value) ? "" : value
  }
}

function secretReferencesOnly(
  secrets: Record<string, JsonValue>,
  fallbackScopeType: string,
  fallbackScopeId: string,
): Record<string, JsonValue> {
  const references: Record<string, JsonValue> = {}
  for (const [name, value] of Object.entries(secrets)) {
    const reference = extractReference(value)
    references[name] = { reference: reference ?? `${fallbackScopeType}:${fallbackScopeId}:${name}` }
  }
  return references
}

function extractReference(value: JsonValue): string | null {
  if (!isRecord(value)) {
    return null
  }
  const reference = value["reference"]
  return typeof reference === "string" && reference.length > 0 ? reference : null
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
