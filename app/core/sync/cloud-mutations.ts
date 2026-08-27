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
  redactBodyLeaves,
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
    // Every remaining string is inspected too (`inspectStringValues`): the
    // server scans *all* config strings for credential material, so a field
    // this sanitizer skips — an assertion's expected value, a script, a
    // GraphQL document — is a field whose workflow silently stops syncing.
    sanitized[key] = sanitizeConfigField(key, value, (nested) => sanitizeValue(nested, true))
  }
  return sanitized
}

// The config fields with structural handling, shared by the live-config and
// snapshot passes so the two cannot drift on what a body or a cookie means.
// A handler returns `undefined` when the field is not the shape it handles, and
// the caller's `fallback` decides everything else — that is the only way the two
// passes differ.
type ConfigFieldSanitizer = (value: unknown) => JsonValue | undefined

// Cookies carry session material under innocuous names, so every cookie value
// is withheld; the other key/value arrays are judged per entry.
const sanitizeCookieField: ConfigFieldSanitizer = (value) =>
  Array.isArray(value) ? sanitizeKeyValueItems(value, true) : undefined
const sanitizeKeyValueField: ConfigFieldSanitizer = (value) =>
  Array.isArray(value) ? sanitizeKeyValueItems(value, false) : undefined

const CONFIG_FIELD_SANITIZERS: Readonly<Record<string, ConfigFieldSanitizer>> = {
  body: (value) => (typeof value === "string" ? sanitizeBodyText(value) : undefined),
  url: (value) => (typeof value === "string" ? sanitizeUrl(value) : undefined),
  auth: (value) => (isRecord(value) ? sanitizeAuthConfig(value) : undefined),
  fileUploads: (value) => (Array.isArray(value) ? sanitizeFileUploads(value) : undefined),
  cookies: sanitizeCookieField,
  headers: sanitizeKeyValueField,
  queryParams: sanitizeKeyValueField,
  pathVariables: sanitizeKeyValueField,
  formDataEntries: sanitizeKeyValueField,
  urlEncodedEntries: sanitizeKeyValueField,
}

function sanitizeConfigField(
  key: string,
  value: unknown,
  fallback: (value: unknown) => JsonValue,
): JsonValue {
  const handler = CONFIG_FIELD_SANITIZERS[key]
  const sanitized = handler === undefined ? undefined : handler(value)
  return sanitized === undefined ? fallback(value) : sanitized
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

// A variable named `token`/`password`/etc. keeps its key even when sensitive:
// dropping the entry outright (as this used to) orphans every
// `{{variables.token}}` reference elsewhere in the workflow the next time this
// device (or another one) pulls the record — the variable just isn't there
// any more. A scalar under that name is blanked unless it's a credential-free
// reference (contract bullet 1); a container is walked instead of judged
// (bullet 2), matching how headers/queryParams already treat a sensitive key.
function sanitizeVariables(variables: Record<string, JsonValue>): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(variables)) {
    const sensitiveScalar = isSyncSensitiveKey(key) && !isRecord(value) && !Array.isArray(value)
    sanitized[key] = sensitiveScalar ? blankUnlessReference(value) : sanitizeValue(value, true)
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
  return jsonScalarOrNull(value)
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
      sanitized[nestedKey] = sanitizeConfigField(nestedKey, nestedValue, sanitizeSnapshotValue)
    }
    return sanitized
  }
  if (typeof value === "string") {
    return containsCredentialMaterial(value) ? "" : value
  }
  return jsonScalarOrNull(value)
}

// Anything left that JSON can carry as-is; anything it cannot (a function, a
// Date, undefined) becomes null rather than travelling as a surprise.
function jsonScalarOrNull(value: unknown): JsonValue {
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
    if (isRecord(item) && isWithheldPairValue(item["value"], value["key"], redactAllValues)) {
      item["value"] = ""
    }
    sanitized.push(item)
  }
  return sanitized
}

// A pair's value is judged by its sibling `key`: under a sensitive name (or in
// a cookie array, where every value counts) only a credential-free reference
// survives; elsewhere only credential material is withheld.
function isWithheldPairValue(value: unknown, key: unknown, redactAllValues: boolean): boolean {
  if (isEmptySyncValue(value)) {
    return false
  }
  const sensitive = redactAllValues || (typeof key === "string" && isSyncSensitiveKey(key))
  if (sensitive) {
    return !isCredentialFreeReference(value)
  }
  return typeof value === "string" && containsCredentialMaterial(value)
}

function blankUnlessReference(value: unknown): JsonValue {
  return isCredentialFreeReference(value) ? value as string : ""
}

// The body walk lives in `services/secret_utils` because the export bundler
// runs the identical one: push blanks a withheld leaf to `""` and export writes
// `<SECRET>`, and that token is the only difference between them.
function sanitizeBodyText(body: string): string {
  return redactBodyLeaves(body, "")
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
