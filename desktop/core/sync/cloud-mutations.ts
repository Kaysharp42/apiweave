import type { Collection } from "../../../shared/types/Collection"
import type { Environment } from "../../../shared/types/Environment"
import type { JsonValue } from "../../../shared/types/JsonValue"
import type { Workflow } from "../../../shared/types/Workflow"
import type { WorkflowNode } from "../../../shared/types/WorkflowNode"
import type { Workspace } from "../../../shared/types/Workspace"
import { ChangeOp, RecordKind } from "@apiweave/proto/apiweave/v1/sync_service_pb"
import { assertNoSecretValues, detectSecretsInValue, isSecretKey } from "../services/secret_utils"
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
  assertNoSecretValues(input.payload as JsonValue)
  syncProvider.recordMutation({
    workspaceId: input.workspaceId,
    kind: input.kind,
    recordId: input.recordId,
    expectedRev: input.expectedRev,
    op: ChangeOp.UPSERT,
    payload: textEncoder.encode(JSON.stringify(input.payload)),
  })
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
    if (isSyncSecretKey(key)) {
      continue
    }
    if (key === "body" && typeof value === "string" && value.trim().length > 0) {
      sanitized[key] = ""
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
    sanitized[key] = sanitizeValue(value)
  }
  return sanitized
}

function sanitizeVariables(variables: Record<string, JsonValue>): Record<string, JsonValue> {
  const sanitized: Record<string, JsonValue> = {}
  for (const [key, value] of Object.entries(variables)) {
    if (!isSyncSecretKey(key)) {
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
      if (!isSyncSecretKey(key)) {
        sanitized[key] = sanitizeValue(nested, inspectStringValues)
      }
    }
    return sanitized
  }
  if (typeof value === "string") {
    return inspectStringValues && containsSecretValue(value) ? "" : value
  }
  if (typeof value === "number" || typeof value === "boolean" || value === null) {
    return value
  }
  return null
}

function sanitizeSnapshotValue(value: unknown, key = ""): JsonValue {
  if (Array.isArray(value)) {
    return value
      .filter((item) => !isSecretKeyValueItem(item))
      .map((item) => sanitizeSnapshotValue(item))
  }
  if (isRecord(value)) {
    const sanitized: Record<string, JsonValue> = {}
    for (const [nestedKey, nestedValue] of Object.entries(value)) {
      if (isSyncSecretKey(nestedKey)) {
        continue
      }
      if (nestedKey === "body" && typeof nestedValue === "string" && nestedValue.trim().length > 0) {
        sanitized[nestedKey] = ""
      } else if (nestedKey === "url" && typeof nestedValue === "string") {
        sanitized[nestedKey] = sanitizeUrl(nestedValue)
      } else if (nestedKey === "cookies" && Array.isArray(nestedValue)) {
        sanitized[nestedKey] = sanitizeKeyValueItems(nestedValue, true)
      } else if (isKeyValueConfigField(nestedKey) && Array.isArray(nestedValue)) {
        sanitized[nestedKey] = sanitizeKeyValueItems(nestedValue, false)
      } else {
        sanitized[nestedKey] = sanitizeSnapshotValue(nestedValue, nestedKey)
      }
    }
    return sanitized
  }
  if (typeof value === "string") {
    return key === "body" || containsSecretValue(value) ? "" : value
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
  return typeof key === "string" && isSyncSecretKey(key)
}

function sanitizeKeyValueItems(values: readonly unknown[], redactAllValues: boolean): JsonValue[] {
  const sanitized: JsonValue[] = []
  for (const value of values) {
    if (!isRecord(value)) {
      sanitized.push(sanitizeValue(value))
      continue
    }
    const key = value["key"]
    if (typeof key === "string" && isSyncSecretKey(key)) {
      continue
    }
    const item = sanitizeValue(value)
    if (isRecord(item) && typeof item["value"] === "string") {
      item["value"] = redactAllValues || containsSecretValue(item["value"])
        ? ""
        : item["value"]
    }
    sanitized.push(item)
  }
  return sanitized
}

function isSyncSecretKey(key: string): boolean {
  return isSecretKey(key) || /^(cookie|set-cookie|session|sessionid|sid|jwt|otp|cvv)$/i.test(key)
}

function isKeyValueConfigField(key: string): boolean {
  return key === "headers"
    || key === "queryParams"
    || key === "pathVariables"
    || key === "formDataEntries"
    || key === "urlEncodedEntries"
}

function containsSecretValue(value: string): boolean {
  return detectSecretsInValue(value) || /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/.test(value)
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
      if (isSyncSecretKey(key) || containsSecretValue(queryValue)) {
        url.searchParams.set(key, "")
      }
    }
    return url.toString()
  } catch {
    return containsSecretValue(value) ? "" : value
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
