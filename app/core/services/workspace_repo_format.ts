import { z } from "zod"
import type { Collection } from "@shared/types/Collection"
import type { Environment } from "@shared/types/Environment"
import type { JsonValue } from "@shared/types/JsonValue"
import type { Workflow } from "@shared/types/Workflow"
import type { Workspace } from "@shared/types/Workspace"
import { JsonValueSchema } from "@shared/zod-schemas/JsonValueSchema"
import { WorkflowEdgeSchema } from "@shared/zod-schemas/WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "@shared/zod-schemas/WorkflowNodeSchema"
import { ValidationError } from "../ipc/errors"
import { slugify } from "../repositories/helpers"
import type { ExportedWorkflow } from "./project_export_service"
import { assertNoSecretValues, sanitizeExportValue, sanitizeVariablesForExport } from "./secret_utils"

/**
 * A workspace as a tree of JSON files, the repository git sync commits:
 *
 *   .apiweave/format.json            {"format": "apiweave-workspace", "version": 1}
 *   .gitattributes                   * text eol=lf
 *   workspace.json                   id, name, description
 *   projects/<slug>--<id>.json       name, description, color, workflow order
 *   workflows/<slug>--<id>.json      one file per workflow, in a project or not
 *   environments/<slug>--<id>.json   workspace-scoped environments: variables
 *
 * Written so a change diffs small and merges cleanly: objects with sorted keys
 * (top-level fields in a fixed order), nodes sorted by id (a group frame before
 * what it holds), edges by id, positions rounded to whole pixels, 2-space
 * indent, LF and a trailing newline, and nothing volatile (no revision,
 * timestamp, run state or local path). The id is part of every file name, so
 * two records never share a path; the slug is cosmetic, and the folders are
 * flat, so moving a workflow between projects edits fields, not paths.
 *
 * Two naming choices worth stating because the plan reads differently. The
 * plan's `id` on a workspace file is this record's `workspaceId`; the plan's
 * "settings" prose means the `description`: `WorkspaceSchema` has no `settings`
 * field, and `name`/`description` are the only shared mutable fields it has.
 *
 * A project file holds two list-shaped facts that are not the same list.
 * `projectId` on a workflow file is membership: the project the workflow
 * belongs to, or null. A project's own `workflowOrder` is run order plus the
 * per-workflow `enabled`/`continueOnFail` flags; it may be partial (the runner
 * takes the saved order first, then appends any member not in it — see
 * `core/runner/project_runner.ts`) and it may name a workflow that has since
 * left the project (a stale entry is ignored, and the canvas rebuilds the order
 * from members). Both fields are written faithfully as stored, so the importer
 * a later PR adds preserves both as stored.
 *
 * Exactly one environment in a workspace is the default (`isDefault`), and the
 * environment file carries the flag because a run with no explicit selection
 * uses it (`ProjectRunPanel`). This module does not enforce "exactly one": a
 * repository can hold a tree with none or several, and a parser must accept a
 * tree this module's own serializer produced, so the flag round-trips as
 * written. Resolving a tree whose defaults are absent, duplicated or stale is
 * the importer's job (a later PR).
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

const WORKSPACE_FORMAT = "apiweave-workspace"
const WORKSPACE_FORMAT_VERSION = 1
const FORMAT_FILE = ".apiweave/format.json"
const ATTRIBUTES_FILE = ".gitattributes"
const WORKSPACE_FILE = "workspace.json"
const MAX_FILE_BYTES = 10 * 1024 * 1024
const MAX_TREE_BYTES = 100 * 1024 * 1024
const MAX_SLUG_LENGTH = 60

/** What an id generated here looks like (a ULID), loosely: an id also names files and rows, so nothing path-like gets in. */
export const RecordIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/, "must be an APIWeave id (letters, digits, '-' and '_', not starting with '-')")

/**
 * A JSON value that must also satisfy `schema`, kept exactly as written:
 * validating must not fill in defaults, or a parsed file would not serialize
 * back to itself.
 */
function conforming(schema: z.ZodType) {
  return JsonValueSchema.superRefine((value, context) => {
    const result = schema.safeParse(value)
    if (result.success) return
    for (const issue of result.error.issues) context.addIssue({ code: "custom", message: issue.message, path: issue.path })
  })
}

const FormatFileSchema = z
  .object({
    format: z.literal(WORKSPACE_FORMAT, { message: "this is not an APIWeave workspace repository" }),
    version: z.literal(WORKSPACE_FORMAT_VERSION, {
      message: `this repository was written by a newer APIWeave (only format version ${WORKSPACE_FORMAT_VERSION} is supported); update APIWeave to open it`,
    }),
  })
  .strict()

const NameSchema = z.string().min(1)
const VariablesSchema = z.record(z.string(), JsonValueSchema)
/** The name and optional description the workspace, its projects and its environments carry alike. */
const titled = { name: NameSchema, description: z.string().nullable() }

const WorkspaceFileSchema = z.object({ workspaceId: RecordIdSchema, ...titled }).strict()

const ProjectFileSchema = z
  .object({
    projectId: RecordIdSchema,
    ...titled,
    color: z.string().nullable(),
    workflowOrder: z.array(z.object({ workflowId: RecordIdSchema, enabled: z.boolean(), continueOnFail: z.boolean() }).strict()),
  })
  .strict()

const WorkflowFileSchema = z
  .object({
    workflowId: RecordIdSchema,
    projectId: RecordIdSchema.nullable(),
    name: NameSchema,
    description: z.string(),
    selectedEnvironmentId: RecordIdSchema.nullable(),
    tags: z.array(z.string()),
    variables: VariablesSchema,
    nodes: z.array(conforming(WorkflowNodeSchema)),
    edges: z.array(conforming(WorkflowEdgeSchema)),
    nodeTemplates: z.array(JsonValueSchema),
  })
  .strict()

const EnvironmentFileSchema = z
  .object({
    environmentId: RecordIdSchema,
    ...titled,
    swaggerDocUrl: z.string().nullable(),
    isDefault: z.boolean(),
    variables: VariablesSchema,
  })
  .strict()

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

interface EnvironmentContent {
  readonly environmentId: string
  readonly name: string
  readonly description?: string | null | undefined
  readonly swaggerDocUrl?: string | null | undefined
  readonly variables: Readonly<Record<string, unknown>>
}

interface ProjectContent {
  readonly projectId: string
  readonly name: string
  readonly description: string | null
  readonly color: string | null
  readonly workflowOrder: readonly { readonly workflowId: string; readonly enabled: boolean; readonly continueOnFail: boolean }[]
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
  const files = new Map<string, string>([[ATTRIBUTES_FILE, "* text eol=lf\n"]])
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

/** JSON with every object's keys sorted, so equal values print equal. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(toPlain(value)))
}

/** A document as file text: top-level fields in the order given, every nested object's keys sorted, 2-space indent, trailing newline. */
export function fileText(document: Record<string, JsonValue>): string {
  return `${JSON.stringify(Object.fromEntries(Object.entries(document).map(([key, value]) => [key, sortKeys(value)])), null, 2)}\n`
}

/** The slug a name contributes to a file name; empty when the name has nothing slug-able. */
export function nameSlug(name: string): string {
  return slugify(name, "").slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "")
}

/** `text` as JSON, or a ValidationError naming `label`. */
function parseJsonText(label: string, text: string): unknown {
  try {
    return JSON.parse(text)
  } catch (error) {
    throw new ValidationError(`${label} is not valid JSON (an unresolved merge conflict?): ${error instanceof Error ? error.message : String(error)}`)
  }
}

/** A zod failure's first issue, as `path: message`. */
export function issueText(error: z.ZodError): string {
  const issue = error.issues[0]
  const at = issue === undefined || issue.path.length === 0 ? "" : `${issue.path.join(".")}: `
  return `${at}${issue?.message ?? "invalid"}`
}

export function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function workspaceDocument(workspace: Pick<Workspace, "workspaceId" | "name" | "description">): Record<string, JsonValue> {
  return { workspaceId: workspace.workspaceId, name: workspace.name, description: workspace.description ?? null }
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

function projectDocument(project: ProjectContent): Record<string, JsonValue> {
  return {
    projectId: project.projectId,
    name: project.name,
    description: project.description,
    color: project.color,
    workflowOrder: project.workflowOrder.map(({ workflowId, enabled, continueOnFail }) => ({ workflowId, enabled, continueOnFail })),
  }
}

/** The workflow file's fields, with `head` (the workspace repository's project link) right after the id. */
function workflowDocument(workflow: ExportedWorkflow, head: Readonly<Record<string, JsonValue>> = {}): Record<string, JsonValue> {
  return {
    workflowId: workflow.workflowId,
    ...head,
    name: workflow.name,
    description: workflow.description ?? "",
    selectedEnvironmentId: workflow.selectedEnvironmentId ?? null,
    tags: [...workflow.tags],
    variables: workflow.variables,
    nodes: sortNodes(workflow.nodes.map(roundPosition)),
    edges: [...workflow.edges].sort((left, right) => compare(field(left, "edgeId"), field(right, "edgeId"))),
    nodeTemplates: [...(workflow.nodeTemplates ?? [])],
  }
}

/** Redacted on the way in as well as out: whatever a snapshot holds, a credential never reaches a file. */
function repoWorkflowDocument(workflow: WorkflowContent & { readonly projectId: string | null }): Record<string, JsonValue> {
  return workflowDocument(exportWorkflow(workflow), { projectId: workflow.projectId })
}

/** The shared environment fields, with `extra` (a workspace repository's `isDefault`) between the URL and the variables. */
function environmentDocument(environment: EnvironmentContent, extra: Readonly<Record<string, JsonValue>> = {}): Record<string, JsonValue> {
  return {
    environmentId: environment.environmentId,
    name: environment.name,
    description: environment.description ?? null,
    swaggerDocUrl: environment.swaggerDocUrl ?? null,
    ...extra,
    variables: toPlain(environment.variables),
  }
}

function repoEnvironmentDocument(environment: EnvironmentContent & { readonly isDefault: boolean }): Record<string, JsonValue> {
  return environmentDocument(
    { ...environment, variables: sanitizeVariablesForExport(asRecord(toPlain(environment.variables))) },
    { isDefault: environment.isDefault },
  )
}

function recordFile(directory: string, id: string, name: string, schema: z.ZodType, document: Record<string, JsonValue>): TreeFile {
  if (!RecordIdSchema.safeParse(id).success) throw new ValidationError(`${directory}: '${id}' is not an APIWeave id, so it cannot name a file`)
  return { path: `${directory}/${nameSlug(name) || "untitled"}--${id}.json`, schema, document }
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

/** No absolute path, drive letter, backslash, empty, `.` or `..` segment. */
function isTreePath(path: string): boolean {
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && !/[\\:\0]/.test(segment))
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

function sortKeys(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortKeys)
  if (value === null || typeof value !== "object") return value
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortKeys(value[key]!)]))
}

function roundPosition(node: JsonValue): JsonValue {
  if (!isRecord(node) || !isRecord(node["position"])) return node
  const { x, y } = node["position"]
  if (typeof x !== "number" || typeof y !== "number") return node
  return { ...node, position: { x: Math.round(x), y: Math.round(y) } }
}

/** By id, except that a group frame comes before the nodes inside it (the canvas needs a parent first). */
function sortNodes(nodes: readonly JsonValue[]): JsonValue[] {
  const parents = new Map(nodes.map((node) => [field(node, "nodeId"), field(node, "parentId")]))
  const depth = (nodeId: string): number => {
    let count = 0
    for (let parent = parents.get(nodeId) ?? ""; parent !== "" && count <= nodes.length; parent = parents.get(parent) ?? "") count += 1
    return count
  }
  return [...nodes].sort((left, right) =>
    depth(field(left, "nodeId")) - depth(field(right, "nodeId")) || compare(field(left, "nodeId"), field(right, "nodeId")))
}

function field(value: JsonValue, key: string): string {
  const found = isRecord(value) ? value[key] : undefined
  return typeof found === "string" ? found : ""
}

function toPlain(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
}

function asRecord(value: JsonValue): Record<string, JsonValue> {
  return isRecord(value) ? value : {}
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
