import fs from "node:fs"
import path from "node:path"
import { z } from "zod"
import type { JsonValue } from "@shared/types/JsonValue"
import type { ProjectFolderExportResult } from "@shared/types/ProjectFolderExportResult"
import type { ProjectFolderImportResult } from "@shared/types/ProjectFolderImportResult"
import { ValidationError } from "../ipc/errors"
import { slugify } from "../repositories/helpers"
import { extractSecretRefsFromString } from "./secret_utils"
import type { ExportedEnvironment, ExportedWorkflow, ProjectBundle, ProjectExportService } from "./project_export_service"

/**
 * A project as a folder of JSON files, for keeping tests in a git repository:
 *
 *   project.json                 name, workflow order (enabled / continueOnFail), the files below, secret names
 *   workflows/<slug>.json        one file per workflow
 *   environments/<slug>.json     one file per environment the workflows use (variables only)
 *
 * Written so a change diffs small and merges cleanly: one workflow per file,
 * objects with sorted keys (top-level fields in a fixed order), nodes sorted
 * by id (a group frame before what it holds), edges by id, positions rounded
 * to whole pixels, 2-space indent and a trailing newline, and nothing volatile
 * (no revision, timestamp, run state or workspace id). Ids are the content's
 * identity; a file name is only the name's slug, so renaming a workflow
 * renames its file. Secret values never enter the folder: `{{secrets.NAME}}`
 * references stay as written and `project.json` lists the names.
 *
 * The folder's files are the ones `project.json` lists. A re-export rewrites
 * those, removes the ones that no longer belong (a deleted or renamed
 * workflow) and leaves every other file alone.
 */

export const PROJECT_FILE = "project.json"
export const FOLDER_FORMAT = "apiweave-project"
export const FOLDER_FORMAT_VERSION = 1

const MAX_SLUG_LENGTH = 60
/** Names Windows will not create a file under, whatever the extension. */
const RESERVED_NAME = /^(con|prn|aux|nul|com\d|lpt\d)$/

const fileEntry = (directory: string) =>
  z.string().regex(new RegExp(`^${directory}/[^/\\\\:]+\\.json$`), `must be a file directly under ${directory}/`)

const ManifestSchema = z
  .object({
    format: z.literal(FOLDER_FORMAT),
    version: z.literal(FOLDER_FORMAT_VERSION, {
      message: `this folder was written by a newer APIWeave (only format version ${FOLDER_FORMAT_VERSION} is supported)`,
    }),
    projectId: z.string().min(1),
    name: z.string().min(1),
    description: z.string(),
    color: z.string(),
    workflows: z.array(
      z.object({ workflowId: z.string().min(1), file: fileEntry("workflows"), enabled: z.boolean(), continueOnFail: z.boolean() }).strict(),
    ),
    environments: z.array(z.object({ environmentId: z.string().min(1), file: fileEntry("environments") }).strict()),
    secrets: z.array(z.string()),
  })
  .strict()

type Manifest = z.infer<typeof ManifestSchema>

/** The folder a bundle becomes: relative path (always `/`-separated) to file content. */
export function projectFolderFiles(bundle: ProjectBundle): Map<string, string> {
  const order = new Map((bundle.project.workflowOrder ?? []).map((item) => [item.workflowId, item]))
  const workflows = bundle.workflows
    .map((workflow) => ({ workflow, item: order.get(workflow.workflowId) }))
    // Workflows the project has no order for (none, normally) follow, by id: never the volatile list order.
    .sort((left, right) => (left.item?.order ?? Number.MAX_SAFE_INTEGER) - (right.item?.order ?? Number.MAX_SAFE_INTEGER)
      || compare(left.workflow.workflowId, right.workflow.workflowId))
  const workflowFiles = fileNames("workflows", bundle.workflows.map((workflow) => ({ id: workflow.workflowId, name: workflow.name })))
  const environmentFiles = fileNames("environments", bundle.environments.map((environment) => ({ id: environment.environmentId, name: environment.name })))

  const files = new Map<string, string>()
  for (const workflow of bundle.workflows) files.set(workflowFiles.get(workflow.workflowId)!, workflowFileText(workflow))
  for (const environment of bundle.environments) {
    files.set(environmentFiles.get(environment.environmentId)!, environmentFileText(environment))
  }
  const secrets = [...new Set(extractSecretRefsFromString(JSON.stringify([bundle.workflows, bundle.environments])))].sort()
  const manifest: Manifest = {
    format: FOLDER_FORMAT,
    version: FOLDER_FORMAT_VERSION,
    projectId: bundle.project.projectId,
    name: bundle.project.name,
    description: bundle.project.description ?? "",
    color: bundle.project.color ?? "",
    workflows: workflows.map(({ workflow, item }) => ({
      workflowId: workflow.workflowId,
      file: workflowFiles.get(workflow.workflowId)!,
      enabled: item?.enabled ?? true,
      continueOnFail: item?.continueOnFail ?? true,
    })),
    environments: [...bundle.environments]
      .sort((left, right) => compare(left.environmentId, right.environmentId))
      .map((environment) => ({ environmentId: environment.environmentId, file: environmentFiles.get(environment.environmentId)! })),
    secrets,
  }
  files.set(PROJECT_FILE, fileText(manifest as unknown as Record<string, JsonValue>))
  return files
}

/** A workflow's file. Also how an import decides a workflow is unchanged: same text, same workflow. */
export function workflowFileText(workflow: ExportedWorkflow): string {
  const nodes = workflow.nodes.map(roundPosition)
  return fileText({
    workflowId: workflow.workflowId,
    name: workflow.name,
    description: workflow.description ?? "",
    selectedEnvironmentId: workflow.selectedEnvironmentId ?? null,
    tags: [...workflow.tags],
    variables: workflow.variables,
    nodes: sortNodes(nodes),
    edges: [...workflow.edges].sort((left, right) => compare(field(left, "edgeId"), field(right, "edgeId"))),
    nodeTemplates: [...(workflow.nodeTemplates ?? [])],
  })
}

export function environmentFileText(environment: ExportedEnvironment): string {
  return fileText({
    environmentId: environment.environmentId,
    name: environment.name,
    description: environment.description ?? null,
    swaggerDocUrl: environment.swaggerDocUrl ?? null,
    variables: environment.variables,
  })
}

/** JSON with every object's keys sorted, so equal values print equal. */
export function stableJson(value: unknown): string {
  return JSON.stringify(sortKeys(JSON.parse(JSON.stringify(value ?? null)) as JsonValue))
}

/** Read a project folder into a bundle the project importer takes. Throws ValidationError naming the file at fault. */
export function readProjectFolder(folder: string): ProjectBundle {
  const manifest = readManifest(folder)
  if (manifest === undefined) {
    throw new ValidationError(`${folder} has no ${PROJECT_FILE}; export a project to this folder first`)
  }
  const workflows = manifest.workflows.map((entry): ExportedWorkflow => {
    const doc = readJsonFile(folder, entry.file)
    if (doc["workflowId"] !== entry.workflowId) {
      throw new ValidationError(`${entry.file}: workflowId must be '${entry.workflowId}', as ${PROJECT_FILE} lists it`)
    }
    return doc as unknown as ExportedWorkflow
  })
  const environments = manifest.environments.map((entry): ExportedEnvironment => {
    const doc = readJsonFile(folder, entry.file)
    if (doc["environmentId"] !== entry.environmentId) {
      throw new ValidationError(`${entry.file}: environmentId must be '${entry.environmentId}', as ${PROJECT_FILE} lists it`)
    }
    return { ...(doc as unknown as ExportedEnvironment), scopeType: "workspace", scopeId: "" }
  })
  return {
    schemaVersion: "2.0",
    type: "awecollection",
    project: {
      projectId: manifest.projectId,
      name: manifest.name,
      description: manifest.description,
      color: manifest.color,
      workflowOrder: manifest.workflows.map((entry, order) => ({
        workflowId: entry.workflowId,
        order,
        enabled: entry.enabled,
        continueOnFail: entry.continueOnFail,
      })),
    },
    workflows,
    environments,
    secretReferences: manifest.secrets.map((name) => ({ name, scopeType: "workspace", scopeId: "" })),
    metadata: {
      exportedAt: "",
      schemaVersion: "2.0",
      workflowCount: workflows.length,
      environmentCount: environments.length,
      secretReferenceCount: manifest.secrets.length,
    },
  }
}

/**
 * Write a project's files into `folder`, in place. Refuses a folder that holds
 * another project, and a file the previous export did not write; removes only
 * files the previous `project.json` listed. `project.json` goes last, so an
 * interrupted export still names every file it owns.
 */
export function writeProjectFolder(folder: string, files: ReadonlyMap<string, string>): Omit<ProjectFolderExportResult, "folder" | "workflowCount" | "environmentCount"> {
  const projectId = (JSON.parse(files.get(PROJECT_FILE)!) as Manifest).projectId
  const previous = readManifest(folder)
  if (previous !== undefined && previous.projectId !== projectId) {
    throw new ValidationError(`${folder} holds another project ('${previous.name}'); choose that project's folder or an empty one`)
  }
  const owned = new Set(previous === undefined ? [] : [...previous.workflows, ...previous.environments].map((entry) => entry.file))
  const foreign = [...files.keys()].filter((file) => {
    if (file === PROJECT_FILE || owned.has(file)) return false
    const existing = readIfExists(path.join(folder, file))
    return existing !== undefined && existing !== files.get(file)
  })
  if (foreign.length > 0) {
    throw new ValidationError(`refusing to overwrite ${foreign.join(", ")} in ${folder}: ${PROJECT_FILE} does not list ${foreign.length === 1 ? "it" : "them"}. Move ${foreign.length === 1 ? "it" : "them"} away or choose another folder`)
  }

  const written: string[] = []
  const ordered = [...files.keys()].filter((file) => file !== PROJECT_FILE).sort().concat(PROJECT_FILE)
  for (const file of ordered) {
    const target = path.join(folder, file)
    if (readIfExists(target) === files.get(file)) continue
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.writeFileSync(target, files.get(file)!, "utf8")
    written.push(file)
  }
  const removed = [...owned].filter((file) => !files.has(file)).sort()
  for (const file of removed) fs.rmSync(path.join(folder, file), { force: true })
  return { written: written.sort(), removed }
}

/** "Export to folder": the project's bundle, as files, written in place. */
export async function exportProjectFolder(
  projects: ProjectExportService,
  workspaceId: string,
  projectId: string,
  folder: string,
): Promise<ProjectFolderExportResult> {
  const bundle = await projects.exportProject(workspaceId, projectId, true)
  // The folder names the project by its row id, which an import matches on.
  const files = projectFolderFiles({ ...bundle, project: { ...bundle.project, projectId } })
  return {
    folder,
    workflowCount: bundle.workflows.length,
    environmentCount: bundle.environments.length,
    ...writeProjectFolder(folder, files),
  }
}

/** "Import from folder", and `apiweave run <folder>`: the folder's project created or updated by id. */
export async function importProjectFolder(
  projects: ProjectExportService,
  workspaceId: string,
  folder: string,
): Promise<ProjectFolderImportResult> {
  return { folder, ...(await projects.upsertProject(workspaceId, readProjectFolder(folder))) }
}

function readManifest(folder: string): Manifest | undefined {
  const text = readIfExists(path.join(folder, PROJECT_FILE))
  if (text === undefined) return undefined
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ValidationError(`${PROJECT_FILE} in ${folder} is not valid JSON (an unresolved merge conflict?): ${errorMessage(error)}`)
  }
  const result = ManifestSchema.safeParse(parsed)
  if (!result.success) {
    const issue = result.error.issues[0]
    const at = issue === undefined || issue.path.length === 0 ? "" : `${issue.path.join(".")}: `
    throw new ValidationError(`${PROJECT_FILE} in ${folder} is not an APIWeave project file: ${at}${issue?.message ?? "invalid"}`)
  }
  const files = [...result.data.workflows, ...result.data.environments].map((entry) => entry.file)
  const duplicate = files.find((file, index) => files.indexOf(file) !== index)
  if (duplicate !== undefined) throw new ValidationError(`${PROJECT_FILE} in ${folder} lists ${duplicate} twice`)
  return result.data
}

function readJsonFile(folder: string, file: string): Record<string, JsonValue> {
  const text = readIfExists(path.join(folder, file))
  if (text === undefined) throw new ValidationError(`${file} is listed in ${PROJECT_FILE} but missing from ${folder}`)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (error) {
    throw new ValidationError(`${file} is not valid JSON (an unresolved merge conflict?): ${errorMessage(error)}`)
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new ValidationError(`${file} must hold a JSON object`)
  return parsed as Record<string, JsonValue>
}

function readIfExists(file: string): string | undefined {
  try {
    return fs.readFileSync(file, "utf8")
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw error
  }
}

/** One file name per item: the name's slug; a clash (or a name Windows reserves) adds the id. Assigned in id order. */
function fileNames(directory: string, items: readonly { readonly id: string; readonly name: string }[]): Map<string, string> {
  const names = new Map<string, string>()
  const taken = new Set<string>()
  for (const item of [...items].sort((left, right) => compare(left.id, right.id))) {
    const slug = slugify(item.name, "").slice(0, MAX_SLUG_LENGTH).replace(/-+$/, "")
    const base = slug === "" || RESERVED_NAME.test(slug) || taken.has(slug) ? `${slug === "" ? "" : `${slug}-`}${item.id.toLowerCase()}` : slug
    taken.add(base)
    names.set(item.id, `${directory}/${base}.json`)
  }
  return names
}

function fileText(doc: Record<string, JsonValue>): string {
  return `${JSON.stringify(Object.fromEntries(Object.entries(doc).map(([key, value]) => [key, sortKeys(value)])), null, 2)}\n`
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

function compare(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function isRecord(value: unknown): value is Record<string, JsonValue> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
