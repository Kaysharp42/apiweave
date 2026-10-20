import type { z } from "zod"
import type { Collection } from "@shared/types/Collection"
import type { Environment } from "@shared/types/Environment"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Workflow } from "@shared/types/Workflow"
import type { Workspace } from "@shared/types/Workspace"
import type { WorkspacePendingChangeKind } from "@shared/types/WorkspacePendingChangeKind"
import {
  ATTRIBUTES_FILE,
  ATTRIBUTES_TEXT,
  EnvironmentFileSchema,
  FORMAT_FILE,
  FormatFileSchema,
  ProjectFileSchema,
  RecordIdSchema,
  WORKSPACE_FILE,
  WORKSPACE_FORMAT,
  WORKSPACE_FORMAT_VERSION,
  WorkflowFileSchema,
  WorkspaceFileSchema,
  compare,
  environmentDocument,
  fileText,
  isTreePath,
  issueText,
  projectDocument,
  recordPath,
  toPlain,
  workflowDocument,
  workspaceDocument,
  type EnvironmentContent,
  type ProjectContent,
} from "@shared/workspace-repo/format"
import { assertNoSecretValues } from "@shared/workspace-repo/secret_storage"
import { ValidationError } from "../ipc/errors"
import type { ExportedWorkflow } from "./project_export_service"
import { sanitizeExportValue, sanitizeVariablesForExport } from "./secret_utils"

/**
 * A workspace's repository, written from its rows and read back: the tree
 * itself — its layout, its schemas and how a record becomes a file — is
 * `shared/workspace-repo/format.ts`.
 *
 * Never written: user-scoped environments, secret values or ciphertext, the
 * names of the secrets stored on this machine, runs, node presets, agents,
 * workflow revisions, an environment's base environment. The stored secret
 * names are local state rather than shared state: a machine that has no value
 * for a name cannot carry "this name exists" (the store holds sealed values
 * only), so writing the local list would have every machine erase the other's
 * names in an endless exchange of commits. The names that matter are in the
 * content anyway, as `{{secrets.NAME}}` wherever they are used. Literal
 * credentials are withheld exactly as an export withholds them (`<SECRET>`);
 * `{{secrets.NAME}}` references stay as written.
 *
 * Everything here is pure: the caller reads the rows and the files.
 *
 * `parseWorkspace` treats its input as untrusted, and enforces exactly this:
 * tree paths (relative, '/'-separated, inside the repository), the per-file and
 * per-tree size limits, the schema of every file it reads, record ids that can
 * name a file and a file name matching the id it holds, and
 * `assertNoSecretValues` for forbidden secret-*storage* fields (`ciphertext`,
 * `kek`, ...) anywhere. It does NOT reject a literal credential in a file: a
 * user may type one deliberately, so a literal is accepted here and withheld
 * as `<SECRET>` the next time the tree is written — the file heals on sync.
 */

/** One repository file's limit. Shared with the tree walk, which enforces it before reading a file. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024
/** The whole tree's limit. Shared with the tree walk, which enforces it while it reads. */
export const MAX_TREE_BYTES = 100 * 1024 * 1024
/** How many files a tree may hold. Enforced by the tree walk file by file, as it reads them. */
export const MAX_TREE_FILES = 10_000

/** A workspace as its repository holds it: one entry per file, credentials withheld, each list in id order. */
export interface WorkspaceSnapshot {
  readonly workspace: z.infer<typeof WorkspaceFileSchema>
  readonly projects: readonly z.infer<typeof ProjectFileSchema>[]
  readonly workflows: readonly z.infer<typeof WorkflowFileSchema>[]
  readonly environments: readonly z.infer<typeof EnvironmentFileSchema>[]
}

/** One workspace's rows, as its repositories return them: what a snapshot is built from. */
export interface WorkspaceRecords {
  readonly workspace: Workspace
  readonly projects: readonly Collection[]
  readonly workflows: readonly Workflow[]
  /** Every environment of the workspace; user-scoped ones are left out of the snapshot here. */
  readonly environments: readonly Environment[]
}

/** The parts of a workflow every export writes, whether it comes from a row or from a file. */
interface WorkflowContent {
  readonly workflowId: string
  readonly name: string
  readonly description?: string | null | undefined
  readonly nodes: readonly unknown[]
  readonly edges: readonly unknown[]
  readonly variables: Readonly<Record<string, unknown>>
  readonly tags: readonly string[]
  readonly selectedEnvironmentId?: string | null | undefined
  readonly nodeTemplates?: readonly unknown[] | undefined
}

interface TreeFile {
  readonly path: string
  readonly schema: z.ZodType
  readonly document: Record<string, JsonValue>
}

/** The snapshot of a workspace's rows: what the repository would hold, withheld credentials included. */
export function workspaceSnapshot(records: WorkspaceRecords): WorkspaceSnapshot {
  const environments = records.environments.filter((environment) => environment.scopeType === "workspace")
  return {
    workspace: checked(`workspace ${records.workspace.workspaceId}`, WorkspaceFileSchema, workspaceDocument(records.workspace)),
    projects: byId(records.projects.map(snapshotProject), (project) => project.projectId),
    workflows: byId(records.workflows.map(snapshotWorkflow), (workflow) => workflow.workflowId),
    environments: byId(environments.map(snapshotEnvironment), (environment) => environment.environmentId),
  }
}

/**
 * The repository's files for a snapshot: relative path (always `/`-separated)
 * to content, in path order. Each file is checked against the schema
 * `parseWorkspace` reads it with, and the whole tree for secret-storage fields,
 * before anything is returned.
 */
export function serializeWorkspace(snapshot: WorkspaceSnapshot): Map<string, string> {
  const tree: TreeFile[] = [
    { path: FORMAT_FILE, schema: FormatFileSchema, document: { format: WORKSPACE_FORMAT, version: WORKSPACE_FORMAT_VERSION } },
    { path: WORKSPACE_FILE, schema: WorkspaceFileSchema, document: workspaceDocument(snapshot.workspace) },
    ...snapshot.projects.map((project) => recordFile("projects", project.projectId, project.name, ProjectFileSchema, projectDocument(project))),
    ...snapshot.workflows.map((workflow) => recordFile("workflows", workflow.workflowId, workflow.name, WorkflowFileSchema, repoWorkflowDocument(workflow))),
    ...snapshot.environments.map((environment) =>
      recordFile("environments", environment.environmentId, environment.name, EnvironmentFileSchema, repoEnvironmentDocument(environment))),
  ]
  assertNoSecretValues(Object.fromEntries(tree.map((file) => [file.path, file.document])))
  const files = new Map<string, string>([[ATTRIBUTES_FILE, ATTRIBUTES_TEXT]])
  for (const file of tree) {
    if (files.has(file.path)) throw new Error(`two records would be written to ${file.path}`)
    checked(file.path, file.schema, file.document)
    files.set(file.path, fileText(file.document))
  }
  return new Map([...files].sort(([left], [right]) => compare(left, right)))
}

/**
 * Read a repository's files into a snapshot. Refuses, with a ValidationError
 * naming the file at fault: a path that leaves the tree, an oversized file or
 * tree, a missing or foreign `format.json`, a file that does not match its
 * schema or carries a secret-storage field, a record file not named after the
 * id it holds, and an id held by two files. Files outside the format's own
 * (a README, CI config) are ignored.
 */
export function parseWorkspace(files: ReadonlyMap<string, string>): WorkspaceSnapshot {
  checkTree(files)
  readFile(files, FORMAT_FILE, FormatFileSchema)
  return {
    workspace: readFile(files, WORKSPACE_FILE, WorkspaceFileSchema),
    projects: readRecords(files, "projects", ProjectFileSchema, (project) => project.projectId),
    workflows: readRecords(files, "workflows", WorkflowFileSchema, (workflow) => workflow.workflowId),
    environments: readRecords(files, "environments", EnvironmentFileSchema, (environment) => environment.environmentId),
  }
}

/** What one repository file holds: which kind of record, its id and its name. */
export interface RecordFileSummary {
  readonly kind: WorkspacePendingChangeKind
  readonly id: string
  readonly name: string
}

/**
 * The record a single file holds, or undefined for a path that is not a
 * record's (`.apiweave/format.json`, `.gitattributes`, a README). Throws a
 * ValidationError when the path is a record's but its text is not: the caller
 * reads one file out of a history, where `parseWorkspace` has no whole tree.
 */
export function describeRecordFile(path: string, text: string): RecordFileSummary | undefined {
  if (path === WORKSPACE_FILE) {
    const workspace = decode(path, text, WorkspaceFileSchema)
    return { kind: "workspace", id: workspace.workspaceId, name: workspace.name }
  }
  const [folder, file, ...rest] = path.split("/")
  if (file === undefined || rest.length > 0 || !file.endsWith(".json")) return undefined
  if (folder === "projects") {
    const project = decode(path, text, ProjectFileSchema)
    return { kind: "project", id: project.projectId, name: project.name }
  }
  if (folder === "workflows") {
    const workflow = decode(path, text, WorkflowFileSchema)
    return { kind: "workflow", id: workflow.workflowId, name: workflow.name }
  }
  if (folder === "environments") {
    const environment = decode(path, text, EnvironmentFileSchema)
    return { kind: "environment", id: environment.environmentId, name: environment.name }
  }
  return undefined
}

/** A workflow as it leaves the app (a bundle, a workspace repository): credentials withheld, ids kept. */
export function exportWorkflow(workflow: WorkflowContent): ExportedWorkflow {
  return {
    workflowId: workflow.workflowId,
    name: workflow.name,
    description: workflow.description ?? "",
    nodes: workflow.nodes.map(exportNode),
    edges: workflow.edges.map((edge) => toPlain(edge)),
    variables: sanitizeVariablesForExport(asRecord(toPlain(workflow.variables))),
    tags: workflow.tags,
    selectedEnvironmentId: workflow.selectedEnvironmentId ?? null,
    nodeTemplates: (workflow.nodeTemplates ?? []).map((template) => sanitizeExportValue(toPlain(template))),
  }
}

export function exportNode(node: unknown): JsonValue {
  const plain = asRecord(toPlain(node))
  if (plain["config"] !== undefined) plain["config"] = sanitizeExportValue(plain["config"])
  return plain
}

/** A workflow's file text, without its project link. Also how an import decides a workflow is unchanged: same text, same workflow. */
export function workflowFileText(workflow: ExportedWorkflow): string {
  return fileText(workflowDocument(workflow))
}

/** `text` as JSON, or a ValidationError naming `label`. */
function parseJsonText(label: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new ValidationError(`${label} is not valid JSON (an unresolved merge conflict?): ${error instanceof Error ? error.message : String(error)}`)
  }
}

function snapshotProject(collection: Collection) {
  return checked(`project ${collection.collectionId}`, ProjectFileSchema, projectDocument(projectContent(collection)))
}

function snapshotWorkflow(workflow: Workflow) {
  return checked(`workflow ${workflow.workflowId}`, WorkflowFileSchema, repoWorkflowDocument({ ...workflow, projectId: workflow.collectionId ?? null }))
}

function snapshotEnvironment(environment: Environment) {
  return checked(`environment ${environment.environmentId}`, EnvironmentFileSchema, repoEnvironmentDocument(environment))
}

function projectContent(collection: Collection): ProjectContent {
  return {
    projectId: collection.collectionId,
    name: collection.name,
    description: collection.description ?? null,
    color: collection.color ?? null,
    // The stored `order` numbers become the list's order, so only their sequence is kept.
    workflowOrder: [...collection.workflowOrder].sort((left, right) => left.order - right.order || compare(left.workflowId, right.workflowId)),
  }
}

/** Redacted on the way in as well as out: whatever a snapshot holds, a credential never reaches a file. */
function repoWorkflowDocument(workflow: WorkflowContent & { readonly projectId: string | null }): Record<string, JsonValue> {
  return workflowDocument(exportWorkflow(workflow), { projectId: workflow.projectId })
}

function repoEnvironmentDocument(environment: EnvironmentContent & { readonly isDefault: boolean }): Record<string, JsonValue> {
  return environmentDocument(
    { ...environment, variables: sanitizeVariablesForExport(asRecord(toPlain(environment.variables))) },
    { isDefault: environment.isDefault },
  )
}

function recordFile(directory: string, id: string, name: string, schema: z.ZodType, document: Record<string, JsonValue>): TreeFile {
  if (!RecordIdSchema.safeParse(id).success) throw new ValidationError(`${directory}: '${id}' is not an APIWeave id, so it cannot name a file`)
  return { path: recordPath(directory, id, name), schema, document }
}

function checked<T>(label: string, schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success) throw new ValidationError(`${label}: ${issueText(result.error)}`)
  return result.data
}

function byId<T>(records: readonly T[], idOf: (record: T) => string): T[] {
  return [...records].sort((left, right) => compare(idOf(left), idOf(right)))
}

/** One file past its limit is refused; a reader calls this with the size on disk, before it reads the file. */
export function checkFileSize(path: string, bytes: number): void {
  if (bytes > MAX_FILE_BYTES) throw new ValidationError(`${path} is ${bytes} bytes; a repository file may be at most ${MAX_FILE_BYTES}`)
}

/** Every path relative, `/`-separated and inside the tree; no file or tree past its size limit. */
function checkTree(files: ReadonlyMap<string, string>): void {
  let total = 0
  for (const [path, text] of files) {
    if (!isTreePath(path)) throw new ValidationError(`refusing ${JSON.stringify(path)}: a repository path must be relative, '/'-separated and stay inside the repository`)
    const bytes = Buffer.byteLength(text, "utf8")
    checkFileSize(path, bytes)
    total += bytes
    if (total > MAX_TREE_BYTES) throw new ValidationError(`${path} pushes the repository over its ${MAX_TREE_BYTES}-byte limit (${total} bytes in total); at most ${MAX_TREE_BYTES} are read`)
  }
}

function readFile<T>(files: ReadonlyMap<string, string>, path: string, schema: z.ZodType<T>): T {
  const text = files.get(path)
  if (text === undefined) throw new ValidationError(`${path} is missing: this is not an APIWeave workspace repository`)
  return decode(path, text, schema)
}

function decode<T>(path: string, text: string, schema: z.ZodType<T>): T {
  const value = parseJsonText(path, text)
  try {
    assertNoSecretValues(value as JsonValue)
  } catch (error) {
    throw new ValidationError(`${path}: ${error instanceof Error ? error.message : String(error)}`)
  }
  return checked(path, schema, value)
}

/** Every file of one record folder: directly inside it, named `<slug>--<id>.json` after the id it holds, each id once. */
function readRecords<T>(files: ReadonlyMap<string, string>, directory: string, schema: z.ZodType<T>, idOf: (record: T) => string): T[] {
  const records = new Map<string, T>()
  for (const [path, text] of files) {
    if (!path.startsWith(`${directory}/`)) continue
    if (!/^[^/]+\.json$/.test(path.slice(directory.length + 1))) {
      throw new ValidationError(`${path}: only <name>--<id>.json files belong in ${directory}/, and not in subfolders`)
    }
    const record = decode(path, text, schema)
    const id = idOf(record)
    if (!new RegExp(`^${directory}/[a-z0-9-]+--${id}\\.json$`).test(path)) {
      throw new ValidationError(`${path}: a file in ${directory}/ must be named <name>--${id}.json, after the id it holds`)
    }
    if (records.has(id)) throw new ValidationError(`${path}: id ${id} is held by two files`)
    records.set(id, record)
  }
  return byId([...records.values()], idOf)
}

function asRecord(value: JsonValue): Record<string, JsonValue> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
