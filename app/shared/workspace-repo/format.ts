import { z } from "zod"
import { slugify } from "../text/slugify"
import type { JsonValue } from "../types/JsonValue"
import type { Workspace } from "../types/Workspace"
import { JsonValueSchema } from "../zod-schemas/JsonValueSchema"
import { WorkflowEdgeSchema } from "../zod-schemas/WorkflowEdgeSchema"
import { WorkflowNodeSchema } from "../zod-schemas/WorkflowNodeSchema"

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
 * preserves both as stored.
 *
 * Exactly one environment in a workspace is the default (`isDefault`), and the
 * environment file carries the flag because a run with no explicit selection
 * uses it (`ProjectRunPanel`). The format does not enforce "exactly one": a
 * repository can hold a tree with none or several, and a parser must accept a
 * tree the serializer produced, so the flag round-trips as written. Resolving a
 * tree whose defaults are absent, duplicated or stale is the importer's job.
 *
 * This module is the format's pure half: the schema of every file, and how a
 * record becomes its path and its text. Everything that writes a file goes
 * through it, so the same record always comes out as the same bytes — the
 * serializer and parser in `core/services/workspace_repo_format.ts`, and the
 * semantic merge in `shared/git-merge/`, whose merge commit must hold exactly
 * what the next ordinary commit would.
 */

export const WORKSPACE_FORMAT = "apiweave-workspace"
export const WORKSPACE_FORMAT_VERSION = 1
export const FORMAT_FILE = ".apiweave/format.json"
export const ATTRIBUTES_FILE = ".gitattributes"
/** What `.gitattributes` always holds: every file is text with LF endings, whatever a checkout's settings say. */
export const ATTRIBUTES_TEXT = "* text eol=lf\n"
export const WORKSPACE_FILE = "workspace.json"
/** The folder each kind of record file sits in, directly. */
export const RECORD_FOLDER = { project: "projects", workflow: "workflows", environment: "environments" } as const
/** The longest slug a record file's name (and a workspace's slug) may carry. */
export const MAX_SLUG_LENGTH = 60
const MAX_NAME_LENGTH = 200
const MAX_DESCRIPTION_LENGTH = 2000

/** Far above the 26 characters of an id generated here (a ULID, `core/id.ts`). */
export const MAX_RECORD_ID_LENGTH = 128

/** The names Windows reserves for devices, with or without an extension: a folder cannot be named after one. */
const WINDOWS_DEVICE_NAME = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\..*)?$/i

/**
 * What an id generated here looks like (a ULID), loosely: an id also names
 * files, rows and a workspace's repository folder, so nothing path-like gets
 * in, and nothing a folder cannot be named on Windows.
 */
export const RecordIdSchema = z
  .string()
  .max(MAX_RECORD_ID_LENGTH, `must be an APIWeave id of at most ${MAX_RECORD_ID_LENGTH} characters`)
  .regex(/^[A-Za-z0-9_][A-Za-z0-9_-]*$/, "must be an APIWeave id (letters, digits, '-' and '_', not starting with '-')")
  .refine((id) => !WINDOWS_DEVICE_NAME.test(id), "must be an APIWeave id, not a name Windows reserves for a device (such as NUL, CON or COM1)")

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

export const FormatFileSchema = z
  .object({
    format: z.literal(WORKSPACE_FORMAT, { message: "this is not an APIWeave workspace repository" }),
    version: z.literal(WORKSPACE_FORMAT_VERSION, {
      message: `this repository was written by a newer APIWeave (only format version ${WORKSPACE_FORMAT_VERSION} is supported); update APIWeave to open it`,
    }),
  })
  .strict()

const NameSchema = z
  .string()
  .min(1)
  .max(MAX_NAME_LENGTH, { message: `a name may be at most ${MAX_NAME_LENGTH} characters` })
const DescriptionSchema = z
  .string()
  .max(MAX_DESCRIPTION_LENGTH, { message: `a description may be at most ${MAX_DESCRIPTION_LENGTH} characters` })
/**
 * Variables, by name. `z.record` cannot hold a variable named `__proto__`: it
 * builds its output by assigning each key onto a fresh object, where that key
 * has a setter, and the variable would be silently lost. This checks every
 * value and keeps the record exactly as the file wrote it — own keys only,
 * `__proto__` included — since a name a user chose is data.
 */
const VariablesSchema = z
  .unknown()
  .superRefine((value, context) => {
    if (!isRecord(value)) {
      context.addIssue({ code: "custom", message: "Expected an object of variables" })
      return
    }
    for (const [key, item] of Object.entries(value)) {
      if (!JsonValueSchema.safeParse(item).success) context.addIssue({ code: "custom", path: [key], message: "Expected a JSON value" })
    }
  })
  .transform((value) => value as Record<string, JsonValue>)
/** The name and optional description the workspace, its projects and its environments carry alike. */
const titled = { name: NameSchema, description: DescriptionSchema.nullable() }

export const WorkspaceFileSchema = z.object({ workspaceId: RecordIdSchema, ...titled }).strict()

export const ProjectFileSchema = z
  .object({
    projectId: RecordIdSchema,
    ...titled,
    color: z.string().nullable(),
    workflowOrder: z.array(z.object({ workflowId: RecordIdSchema, enabled: z.boolean(), continueOnFail: z.boolean() }).strict()),
  })
  .strict()

export const WorkflowFileSchema = z
  .object({
    workflowId: RecordIdSchema,
    projectId: RecordIdSchema.nullable(),
    name: NameSchema,
    description: DescriptionSchema,
    selectedEnvironmentId: RecordIdSchema.nullable(),
    tags: z.array(z.string()),
    variables: VariablesSchema,
    nodes: z.array(conforming(WorkflowNodeSchema)),
    edges: z.array(conforming(WorkflowEdgeSchema)),
    nodeTemplates: z.array(JsonValueSchema),
  })
  .strict()

export const EnvironmentFileSchema = z
  .object({
    environmentId: RecordIdSchema,
    ...titled,
    swaggerDocUrl: z.string().nullable(),
    isDefault: z.boolean(),
    variables: VariablesSchema,
  })
  .strict()

/** What a project file holds. */
export interface ProjectContent {
  readonly projectId: string
  readonly name: string
  readonly description: string | null
  readonly color: string | null
  readonly workflowOrder: readonly { readonly workflowId: string; readonly enabled: boolean; readonly continueOnFail: boolean }[]
}

/** What a workflow file holds besides its project link: an export's workflow, or a file's. */
interface WorkflowFileContent {
  readonly workflowId: string
  readonly name: string
  readonly description?: string | null | undefined
  readonly selectedEnvironmentId?: string | null | undefined
  readonly tags: readonly string[]
  readonly variables: Readonly<Record<string, JsonValue>>
  readonly nodes: readonly JsonValue[]
  readonly edges: readonly JsonValue[]
  readonly nodeTemplates?: readonly JsonValue[] | undefined
}

/** What an environment file holds besides its default flag. */
export interface EnvironmentContent {
  readonly environmentId: string
  readonly name: string
  readonly description?: string | null | undefined
  readonly swaggerDocUrl?: string | null | undefined
  readonly variables: Readonly<Record<string, unknown>>
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

/** Where a record's file goes: `<folder>/<slug>--<id>.json`, the slug from its name. The id must be one `RecordIdSchema` accepts. */
export function recordPath(folder: string, id: string, name: string): string {
  return `${folder}/${nameSlug(name) || "untitled"}--${id}.json`
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

/** Whether a path stays inside the repository: relative, `/`-separated, and no empty, `.` or `..` segment, drive letter, backslash or NUL. */
export function isTreePath(path: string): boolean {
  return path.split("/").every((segment) => segment !== "" && segment !== "." && segment !== ".." && !/[\\:\0]/.test(segment))
}

export function workspaceDocument(workspace: Pick<Workspace, "workspaceId" | "name" | "description">): Record<string, JsonValue> {
  return { workspaceId: workspace.workspaceId, name: workspace.name, description: workspace.description ?? null }
}

export function projectDocument(project: ProjectContent): Record<string, JsonValue> {
  return {
    projectId: project.projectId,
    name: project.name,
    description: project.description,
    color: project.color,
    workflowOrder: project.workflowOrder.map(({ workflowId, enabled, continueOnFail }) => ({ workflowId, enabled, continueOnFail })),
  }
}

/** The workflow file's fields, with `head` (the workspace repository's project link) right after the id. */
export function workflowDocument(workflow: WorkflowFileContent, head: Readonly<Record<string, JsonValue>> = {}): Record<string, JsonValue> {
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

/** The shared environment fields, with `extra` (a workspace repository's `isDefault`) between the URL and the variables. */
export function environmentDocument(environment: EnvironmentContent, extra: Readonly<Record<string, JsonValue>> = {}): Record<string, JsonValue> {
  return {
    environmentId: environment.environmentId,
    name: environment.name,
    description: environment.description ?? null,
    swaggerDocUrl: environment.swaggerDocUrl ?? null,
    ...extra,
    variables: toPlain(environment.variables),
  }
}

/** A value as plain JSON: what `JSON.stringify` keeps of it, `undefined` as null. */
export function toPlain(value: unknown): JsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as JsonValue
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

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}
