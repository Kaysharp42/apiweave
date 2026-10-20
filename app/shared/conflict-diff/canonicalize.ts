import type { z } from "zod"
import type { JsonValue } from "../types/JsonValue"
import type { WorkspacePendingChangeKind } from "../types/WorkspacePendingChangeKind"
import {
  EnvironmentFileSchema,
  ProjectFileSchema,
  WorkflowFileSchema,
  WorkspaceFileSchema,
  environmentDocument,
  issueText,
  projectDocument,
  workflowDocument,
  workspaceDocument,
} from "../workspace-repo/format"

/**
 * A record's canonical form, for comparing and merging copies of it.
 *
 * The repository format is already canonical: sorted keys, a fixed top-level
 * field order, nodes in parent-first id order, edges by id, positions rounded,
 * and nothing volatile. So canonicalizing a record is exactly reading it: the
 * file's value goes through its kind's schema and comes back as the document
 * the serializer writes. Two copies that only differ in how they were written —
 * a node array in another order, a position with a fraction — canonicalize to
 * the same text, and a diff or a merge never mistakes that for an edit.
 *
 * The cloud-era canonicalizer neutralized per-surface identity fields (`rev`,
 * `updatedAt`, a remapped `workspaceId`) because the same record had different
 * ids on each surface. A repository has no second surface: every copy holds the
 * record's own id, so there is nothing left to neutralize and only the format's
 * writer decides the shape.
 */

/** A record as its file holds it: one JSON object. */
export type RecordDocument = Record<string, JsonValue>

/** One record read and written back in canonical form, or why a value is not that record. */
export type RecordRead = { readonly document: RecordDocument } | { readonly invalid: string }

/** One kind of record file: the field its id is in, and the record as its file writes it — or why a value is no such record. */
interface RecordFormat {
  readonly idField: string
  readonly write: (value: JsonValue) => RecordRead
}

function recordFormat<T>(idField: string, schema: z.ZodType<T>, document: (record: T) => RecordDocument): RecordFormat {
  return {
    idField,
    write: (value) => {
      const parsed = schema.safeParse(value)
      return parsed.success ? { document: document(parsed.data) } : { invalid: issueText(parsed.error) }
    },
  }
}

const FORMATS: Readonly<Record<WorkspacePendingChangeKind, RecordFormat>> = {
  workspace: recordFormat("workspaceId", WorkspaceFileSchema, workspaceDocument),
  project: recordFormat("projectId", ProjectFileSchema, projectDocument),
  workflow: recordFormat("workflowId", WorkflowFileSchema, (workflow) => workflowDocument(workflow, { projectId: workflow.projectId })),
  environment: recordFormat("environmentId", EnvironmentFileSchema, (environment) => environmentDocument(environment, { isDefault: environment.isDefault })),
}

/** A file's JSON as the canonical record it holds — validated, in the serializer's field order — or why it is not one. */
export function canonicalizeRecord(kind: WorkspacePendingChangeKind, value: JsonValue): RecordRead {
  return FORMATS[kind].write(value)
}

/** The id a canonical record holds. */
export function recordIdOf(kind: WorkspacePendingChangeKind, record: RecordDocument): string {
  const id = own(record, FORMATS[kind].idField)
  if (typeof id !== "string") throw new Error(`a ${kind} record holds no ${FORMATS[kind].idField}`)
  return id
}

/** The name a canonical record holds; every kind the format writes has one. */
export function recordNameOf(record: RecordDocument): string {
  const name = own(record, "name")
  return typeof name === "string" ? name : ""
}

/** The value an object holds under `key` itself — never one it inherits, as `__proto__` or `toString` would be. */
function own(value: Record<string, JsonValue>, key: string): JsonValue | undefined {
  return Object.hasOwn(value, key) ? value[key] : undefined
}
