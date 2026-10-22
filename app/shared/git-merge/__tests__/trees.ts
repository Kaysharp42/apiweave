import type { z } from "zod"
import type { JsonValue } from "../../types/JsonValue"
import {
  ATTRIBUTES_FILE,
  ATTRIBUTES_TEXT,
  FORMAT_FILE,
  WORKSPACE_FILE,
  WORKSPACE_FORMAT,
  WORKSPACE_FORMAT_VERSION,
  compare,
  environmentDocument,
  fileText,
  projectDocument,
  recordPath,
  workflowDocument,
  workspaceDocument,
  type EnvironmentFileSchema,
  type ProjectFileSchema,
  type WorkflowFileSchema,
  type WorkspaceFileSchema,
} from "../../workspace-repo/format"

export type Json = Record<string, JsonValue>
export type WorkspaceFile = z.infer<typeof WorkspaceFileSchema>
export type ProjectFile = z.infer<typeof ProjectFileSchema>
export type WorkflowFile = z.infer<typeof WorkflowFileSchema>
export type EnvironmentFile = z.infer<typeof EnvironmentFileSchema>

/** A workspace as one copy of its repository holds it. */
export interface Tree {
  workspace: WorkspaceFile
  projects: ProjectFile[]
  workflows: WorkflowFile[]
  environments: EnvironmentFile[]
  /** Files the format does not own, by path. */
  others: Record<string, string>
}

export const WORKSPACE_ID = "ws_01"

/** A tree's files, laid out and written as the serializer writes them (`core/services/workspace_repo_format.ts`). */
export function treeOf(tree: Tree): Map<string, string> {
  const files: [string, string][] = [
    [FORMAT_FILE, fileText({ format: WORKSPACE_FORMAT, version: WORKSPACE_FORMAT_VERSION })],
    [ATTRIBUTES_FILE, ATTRIBUTES_TEXT],
    [WORKSPACE_FILE, fileText(workspaceDocument(tree.workspace))],
    ...tree.projects.map((item): [string, string] => [recordPath("projects", item.projectId, item.name), fileText(projectDocument(item))]),
    ...tree.workflows.map((item): [string, string] => [recordPath("workflows", item.workflowId, item.name), fileText(workflowDocument(item, { projectId: item.projectId }))]),
    ...tree.environments.map((item): [string, string] => [
      recordPath("environments", item.environmentId, item.name),
      fileText(environmentDocument(item, { isDefault: item.isDefault })),
    ]),
    ...Object.entries(tree.others),
  ]
  return new Map(files.sort(([left], [right]) => compare(left, right)))
}

/** A copy of `tree` with `edit` applied: what one device's edits make of it. */
export function edited(tree: Tree, edit: (draft: Tree) => void): Tree {
  const draft = structuredClone(tree)
  edit(draft)
  return draft
}

export function workflow(workflowId: string, fields: Partial<WorkflowFile> = {}): WorkflowFile {
  return {
    workflowId,
    projectId: null,
    name: `Flow ${workflowId}`,
    description: "",
    selectedEnvironmentId: null,
    tags: [],
    variables: {},
    nodes: [],
    edges: [],
    nodeTemplates: [],
    ...fields,
  }
}

export function project(projectId: string, fields: Partial<ProjectFile> = {}): ProjectFile {
  return { projectId, name: `Project ${projectId}`, description: null, color: null, workflowOrder: [], ...fields }
}

export function environment(environmentId: string, fields: Partial<EnvironmentFile> = {}): EnvironmentFile {
  return { environmentId, name: `Env ${environmentId}`, description: null, swaggerDocUrl: null, isDefault: false, variables: {}, ...fields }
}

/** A delay node: the one type whose config any merge of two of its configs keeps valid. */
export function node(nodeId: string, x: number, y: number, fields: Json = {}): Json {
  return { nodeId, type: "delay", position: { x, y }, config: { duration: 100 }, ...fields }
}

export function frame(nodeId: string, x: number, y: number): Json {
  return { nodeId, type: "group", position: { x, y }, config: { width: 400, height: 200 } }
}

export function edge(edgeId: string, source: string, target: string, fields: Json = {}): Json {
  return { edgeId, source, target, ...fields }
}

/** The tree the table tests start from: a project holding two workflows, one more workflow in no project, two environments. */
export function sampleTree(): Tree {
  return {
    workspace: { workspaceId: WORKSPACE_ID, name: "Acme QA", description: null },
    projects: [project("prj_shop", { name: "Shop", workflowOrder: [
      { workflowId: "wf_login", enabled: true, continueOnFail: false },
      { workflowId: "wf_orders", enabled: true, continueOnFail: false },
    ] })],
    workflows: [
      workflow("wf_login", {
        projectId: "prj_shop",
        name: "Login",
        selectedEnvironmentId: "env_dev",
        tags: ["smoke"],
        variables: { user: "alice", region: "eu" },
        nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }, node("n1", 200, 0), node("n2", 400, 0), node("n3", 600, 0)],
        edges: [edge("e1", "start", "n1"), edge("e2", "n1", "n2"), edge("e3", "n2", "n3")],
      }),
      workflow("wf_orders", { projectId: "prj_shop", name: "Orders", nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }] }),
      workflow("wf_free", { name: "Scratch" }),
    ],
    environments: [
      environment("env_dev", { name: "Dev", isDefault: true, variables: { baseUrl: "https://dev.example.test" } }),
      environment("env_prod", { name: "Prod", variables: { baseUrl: "https://example.test" } }),
    ],
    others: { "README.md": "# Acme API tests\n" },
  }
}

/** The record a merged tree holds under `id`, parsed; undefined when it holds none. */
export function recordIn(files: ReadonlyMap<string, string>, folder: string, id: string): Json | undefined {
  const entry = [...files].find(([path]) => path.startsWith(`${folder}/`) && path.endsWith(`--${id}.json`))
  return entry === undefined ? undefined : (JSON.parse(entry[1]) as Json)
}

export function workflowIn(tree: Tree, workflowId: string): WorkflowFile {
  const found = tree.workflows.find((item) => item.workflowId === workflowId)
  if (found === undefined) throw new Error(`no workflow ${workflowId}`)
  return found
}

/** A node of a workflow, to edit in place. */
export function nodeIn(item: WorkflowFile, nodeId: string): Json {
  const found = item.nodes.find((candidate) => (candidate as Json)["nodeId"] === nodeId)
  if (found === undefined) throw new Error(`no node ${nodeId}`)
  return found as Json
}
