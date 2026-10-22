import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { CollectionRepository, EnvironmentRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import { ScopeResolver } from "../scope_resolver"
import { ProjectExportService } from "../project_export_service"
import { exportProjectFolder, importProjectFolder, PROJECT_FILE, writeProjectFolder } from "../project_folder"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

interface Store {
  readonly db: InitializedDatabase
  readonly workspaces: WorkspaceRepository
  readonly workflows: WorkflowRepository
  readonly environments: EnvironmentRepository
  readonly collections: CollectionRepository
  readonly projects: ProjectExportService
  readonly workspaceId: string
}

const stores: Store[] = []
let folder: string

function openStore(slug = "local"): Store {
  const db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const workflows = new WorkflowRepository(db.kvStore)
  const environments = new EnvironmentRepository(db.kvStore)
  const collections = new CollectionRepository(db.kvStore)
  const scopeResolver = new ScopeResolver({
    workspaceExists: (id) => workspaces.getById(id) !== undefined,
    environmentExists: (id) => environments.getById(id) !== undefined,
  })
  const projects = new ProjectExportService(
    collections, workflows, environments, scopeResolver,
  )
  const store = { db, workspaces, workflows, environments, collections, projects, workspaceId: workspaces.create({ name: slug, slug }).workspaceId }
  stores.push(store)
  return store
}

const http = (nodeId: string, url: string, x = 240.4): WorkflowNode => ({
  nodeId,
  type: "http-request",
  label: nodeId,
  position: { x, y: 10.6 },
  config: { method: "GET", url, headers: [{ key: "Authorization", value: "Bearer {{secrets.API_TOKEN}}" }] },
}) as WorkflowNode

/** A project with two workflows (nodes out of order, a frame after its child, float positions) and one environment. */
function seedProject(store: Store): { projectId: string; loginId: string; ordersId: string; environmentId: string } {
  const { workspaceId } = store
  const environment = store.environments.create({ workspaceId, name: "Staging", variables: { baseUrl: "https://staging.example.com", apiKey: "literal-key" } })
  const project = store.collections.create({ workspaceId, name: "Shop API", color: "#123456" })
  const login = store.workflows.create({
    workspaceId,
    name: "Login",
    collectionId: project.collectionId,
    selectedEnvironmentId: environment.environmentId,
    variables: { user: "alice" },
    tags: ["smoke"],
    nodes: [
      { nodeId: "z-end", type: "end", position: { x: 900, y: 0 } } as WorkflowNode,
      { ...http("b-child", "{{env.baseUrl}}/login"), parentId: "y-frame" } as WorkflowNode,
      { nodeId: "y-frame", type: "group", position: { x: 100, y: 0 }, config: { width: 400, height: 200 } } as WorkflowNode,
      { nodeId: "a-start", type: "start", position: { x: 0.2, y: 0 } } as WorkflowNode,
    ],
    edges: [
      { edgeId: "e2", source: "b-child", target: "z-end" },
      { edgeId: "e1", source: "a-start", target: "b-child" },
    ],
  })
  const orders = store.workflows.create({
    workspaceId,
    name: "Orders / list",
    collectionId: project.collectionId,
    selectedEnvironmentId: environment.environmentId,
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } } as WorkflowNode,
      http("list", "{{env.baseUrl}}/orders"),
      http("detail", "{{env.baseUrl}}/orders/1", 480),
    ],
    edges: [
      { edgeId: "e1", source: "start", target: "list" },
      { edgeId: "e2", source: "list", target: "detail" },
    ],
  })
  store.collections.update(project.collectionId, {
    workflowOrder: [
      { workflowId: orders.workflowId, order: 0, enabled: true, continueOnFail: false },
      { workflowId: login.workflowId, order: 1, enabled: false, continueOnFail: true },
    ],
  })
  return { projectId: project.collectionId, loginId: login.workflowId, ordersId: orders.workflowId, environmentId: environment.environmentId }
}

function readFolder(dir: string): Record<string, string> {
  const files: Record<string, string> = {}
  for (const entry of fs.readdirSync(dir, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = path.join(entry.parentPath, entry.name)
    files[path.relative(dir, full).split(path.sep).join("/")] = fs.readFileSync(full, "utf8")
  }
  return files
}

function editJson(file: string, edit: (doc: Record<string, unknown>) => void): void {
  const doc = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>
  edit(doc)
  fs.writeFileSync(file, JSON.stringify(doc))
}

beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-folder-"))
})

afterEach(() => {
  for (const store of stores.splice(0)) store.db.close()
  fs.rmSync(folder, { recursive: true, force: true })
})

describe("project folder format", () => {
  it("writes one file per workflow and environment, deterministically, with nothing volatile and no secret values", async () => {
    const store = openStore()
    const { projectId, loginId, ordersId, environmentId } = seedProject(store)

    const result = await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)

    const files = readFolder(folder)
    expect(Object.keys(files).sort()).toEqual(["environments/staging.json", "project.json", "workflows/login.json", "workflows/orders-list.json"])
    expect(result.written).toEqual(Object.keys(files).sort())
    expect(result.removed).toEqual([])
    for (const text of Object.values(files)) {
      expect(text.endsWith("}\n")).toBe(true)
      expect(text).toMatch(/^\{\n {2}"/)
      expect(text).not.toContain(store.workspaceId)
      expect(text).not.toMatch(/"(rev|createdAt|updatedAt|exportedAt)"/)
    }
    expect(JSON.parse(files["project.json"]!)).toEqual({
      format: "apiweave-project",
      version: 1,
      projectId,
      name: "Shop API",
      description: "",
      color: "#123456",
      workflows: [
        { workflowId: ordersId, file: "workflows/orders-list.json", enabled: true, continueOnFail: false },
        { workflowId: loginId, file: "workflows/login.json", enabled: false, continueOnFail: true },
      ],
      environments: [{ environmentId, file: "environments/staging.json" }],
      secrets: ["API_TOKEN"],
    })
    const login = JSON.parse(files["workflows/login.json"]!) as { nodes: { nodeId: string; position: unknown }[]; edges: { edgeId: string }[] }
    // A frame precedes the node inside it; otherwise by id. Positions are whole pixels.
    expect(login.nodes.map((node) => node.nodeId)).toEqual(["a-start", "y-frame", "z-end", "b-child"])
    expect(login.nodes.map((node) => node.position)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 900, y: 0 }, { x: 240, y: 11 }])
    expect(login.edges.map((edge) => edge.edgeId)).toEqual(["e1", "e2"])
    // A literal credential is withheld; a reference stays.
    expect(files["environments/staging.json"]).toContain('"apiKey": "<SECRET>"')
    expect(files["environments/staging.json"]).not.toContain("literal-key")
    expect(files["workflows/login.json"]).toContain("Bearer {{secrets.API_TOKEN}}")

    // Exporting again changes nothing.
    const again = await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    expect(again.written).toEqual([])
    expect(readFolder(folder)).toEqual(files)
  })

  it("round-trips DB → folder → fresh DB → folder byte for byte, ids kept", async () => {
    const source = openStore()
    const { projectId } = seedProject(source)
    await exportProjectFolder(source.projects, source.workspaceId, projectId, folder)
    const first = readFolder(folder)

    const fresh = openStore("fresh")
    const imported = await importProjectFolder(fresh.projects, fresh.workspaceId, folder)
    expect(imported).toMatchObject({ projectId, created: 2, updated: 0, unchanged: 0, detached: 0, environmentCount: 1 })
    expect(imported.missingSecrets).toEqual(["API_TOKEN"])

    const second = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-folder-"))
    try {
      await exportProjectFolder(fresh.projects, fresh.workspaceId, projectId, second)
      expect(readFolder(second)).toEqual(first)
    } finally {
      fs.rmSync(second, { recursive: true, force: true })
    }
    // Importing the same folder again is a no-op.
    expect(await importProjectFolder(fresh.projects, fresh.workspaceId, folder)).toMatchObject({ created: 0, updated: 0, unchanged: 2 })
  })

  it("a one-node change rewrites only that workflow's file, on few lines", async () => {
    const store = openStore()
    const { projectId, ordersId } = seedProject(store)
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    const before = readFolder(folder)

    const orders = store.workflows.getById(ordersId)!
    store.workflows.update(ordersId, {
      nodes: orders.nodes.map((node) => (node.nodeId === "detail" ? { ...node, label: "Order detail" } : node)),
    })
    const result = await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)

    expect(result.written).toEqual(["workflows/orders-list.json"])
    const oldLines = before["workflows/orders-list.json"]!.split("\n")
    const newLines = fs.readFileSync(path.join(folder, "workflows/orders-list.json"), "utf8").split("\n")
    expect(newLines).toHaveLength(oldLines.length)
    expect(newLines.filter((line, index) => line !== oldLines[index])).toEqual(['      "label": "Order detail",'])
  })

  it("updates in place: renames and deletions remove only the files the project wrote", async () => {
    const store = openStore()
    const { projectId, loginId, ordersId } = seedProject(store)
    fs.writeFileSync(path.join(folder, "README.md"), "# API tests\n")
    fs.mkdirSync(path.join(folder, "workflows"))
    fs.writeFileSync(path.join(folder, "workflows", "notes.json"), "{}\n")
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)

    store.workflows.update(loginId, { name: "Sign in" })
    store.workflows.delete(ordersId)
    const result = await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)

    expect(result.written).toEqual(["project.json", "workflows/sign-in.json"])
    expect(result.removed).toEqual(["workflows/login.json", "workflows/orders-list.json"])
    expect(Object.keys(readFolder(folder)).sort()).toEqual([
      "README.md", "environments/staging.json", "project.json", "workflows/notes.json", "workflows/sign-in.json",
    ])
  })

  it("refuses a folder holding another project, or a file it did not write", async () => {
    const store = openStore()
    const { projectId } = seedProject(store)
    const other = store.collections.create({ workspaceId: store.workspaceId, name: "Other" })
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)

    await expect(exportProjectFolder(store.projects, store.workspaceId, other.collectionId, folder)).rejects.toThrow(/holds another project \('Shop API'\)/)

    const empty = fs.mkdtempSync(path.join(os.tmpdir(), "apiweave-folder-"))
    try {
      fs.mkdirSync(path.join(empty, "workflows"))
      fs.writeFileSync(path.join(empty, "workflows", "login.json"), "{\"mine\": true}\n")
      await expect(exportProjectFolder(store.projects, store.workspaceId, projectId, empty)).rejects.toThrow(/refusing to overwrite workflows\/login.json/)
      expect(fs.readFileSync(path.join(empty, "workflows", "login.json"), "utf8")).toBe("{\"mine\": true}\n")
    } finally {
      fs.rmSync(empty, { recursive: true, force: true })
    }
  })

  it("refuses a project.json that names a file outside its folders", async () => {
    const store = openStore()
    const { projectId } = seedProject(store)
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    editJson(path.join(folder, PROJECT_FILE), (doc) => {
      (doc["workflows"] as { file: string }[])[0]!.file = "workflows/../../outside.json"
    })

    await expect(importProjectFolder(store.projects, store.workspaceId, folder)).rejects.toThrow(/must be a file directly under workflows\//)
    await expect(exportProjectFolder(store.projects, store.workspaceId, projectId, folder)).rejects.toThrow(/not an APIWeave project file/)
  })

  it("never names a file after a path-like id, and refuses to write outside the folder", async () => {
    const store = openStore()
    const { projectId } = seedProject(store)
    // A name that slugs to empty puts the id in the file name.
    store.workflows.create({ workflowId: "../../evil", workspaceId: store.workspaceId, name: "!!!", collectionId: projectId })
    const target = path.join(folder, "inner")

    await exportProjectFolder(store.projects, store.workspaceId, projectId, target)

    expect(fs.existsSync(path.join(target, "workflows", "evil.json"))).toBe(true)
    expect(fs.readdirSync(folder)).toEqual(["inner"])
    const files = new Map([["../outside.json", "{}\n"], [PROJECT_FILE, fs.readFileSync(path.join(target, PROJECT_FILE), "utf8")]])
    expect(() => writeProjectFolder(path.join(folder, "other"), files)).toThrow(/refusing to write \.\.\/outside\.json: it is outside/)
    expect(fs.readdirSync(folder)).toEqual(["inner"])
  })
})

describe("import from a project folder", () => {
  it("updates a changed workflow through the save path, keeping a revision; leaves unchanged ones alone", async () => {
    const store = openStore()
    const { projectId, loginId, ordersId } = seedProject(store)
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    const loginRev = store.workflows.getById(loginId)!.rev
    editJson(path.join(folder, "workflows/orders-list.json"), (doc) => {
      doc["description"] = "Lists orders"
    })

    const result = await importProjectFolder(store.projects, store.workspaceId, folder)

    expect(result).toMatchObject({ created: 0, updated: 1, unchanged: 1, detached: 0 })
    expect(store.workflows.getById(ordersId)!.description).toBe("Lists orders")
    expect(store.workflows.revisions.list(ordersId).map((revision) => revision.source)).toEqual(["import"])
    expect(store.workflows.getById(loginId)!.rev).toBe(loginRev)
    expect(store.workflows.revisions.list(loginId)).toEqual([])
  })

  it("keeps a credential the export withheld when its node is unchanged, and the environment's too", async () => {
    const store = openStore()
    const { projectId, ordersId, environmentId } = seedProject(store)
    const orders = store.workflows.getById(ordersId)!
    const literal = { key: "Authorization", value: "Bearer live-literal-token" }
    store.workflows.update(ordersId, {
      nodes: orders.nodes.map((node) => (node.nodeId === "list" && node.type === "http-request" ? { ...node, config: { ...node.config, headers: [literal] } } : node)),
    })
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    expect(fs.readFileSync(path.join(folder, "workflows/orders-list.json"), "utf8")).not.toContain("live-literal-token")
    editJson(path.join(folder, "workflows/orders-list.json"), (doc) => {
      doc["tags"] = ["changed"]
    })
    editJson(path.join(folder, "environments/staging.json"), (doc) => {
      (doc["variables"] as Record<string, string>)["baseUrl"] = "https://staging2.example.com"
    })

    await importProjectFolder(store.projects, store.workspaceId, folder)

    const list = store.workflows.getById(ordersId)!.nodes.find((node) => node.nodeId === "list")!
    expect(list.type === "http-request" ? list.config?.headers : undefined).toEqual([literal])
    expect(store.workflows.getById(ordersId)!.tags).toEqual(["changed"])
    expect(store.environments.getById(environmentId)!.variables).toEqual({ baseUrl: "https://staging2.example.com", apiKey: "literal-key" })
  })

  it("moves a workflow the folder no longer has out of the project, without deleting it", async () => {
    const store = openStore()
    const { projectId } = seedProject(store)
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    const extra = store.workflows.create({ workspaceId: store.workspaceId, name: "Scratch", collectionId: projectId })

    const result = await importProjectFolder(store.projects, store.workspaceId, folder)

    expect(result.detached).toBe(1)
    expect(result.warnings).toContain("Workflow 'Scratch' is not in the folder; it was moved out of the project (not deleted)")
    expect(store.workflows.getById(extra.workflowId)!.collectionId).toBeNull()
    expect(store.collections.getById(projectId)!.workflowCount).toBe(2)
  })

  it("pulls a workflow back from another project, and warns about withheld credentials and unknown call targets", async () => {
    const store = openStore()
    const { projectId, loginId, ordersId } = seedProject(store)
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    const other = store.collections.create({ workspaceId: store.workspaceId, name: "Other" })
    store.workflows.update(loginId, { collectionId: other.collectionId })
    store.collections.update(other.collectionId, { workflowCount: 1 })
    editJson(path.join(folder, "workflows/orders-list.json"), (doc) => {
      const nodes = doc["nodes"] as Record<string, unknown>[]
      nodes[1]!["config"] = { ...(nodes[1]!["config"] as Record<string, unknown>), url: "<SECRET>" }
      nodes.push({ nodeId: "call", type: "workflow", label: "Call", position: { x: 0, y: 0 }, config: { targetWorkflowId: "wf-gone", targetWorkflowName: "Gone" } })
    })

    const result = await importProjectFolder(store.projects, store.workspaceId, folder)

    expect(result).toMatchObject({ created: 0, updated: 2, unchanged: 0, detached: 0 })
    expect(result.warnings).toEqual([
      "Secret 'API_TOKEN' is not set in this workspace; add it before running the project",
      "Call Workflow node 'Call' in workflow 'Orders / list' targeted workflow 'wf-gone', which is not in the import or this workspace; its target was cleared",
      expect.stringMatching(/^Workflow 'Orders \/ list' has the placeholder "<SECRET>" at .+; the version before this import is in the workflow's history$/),
    ])
    const call = store.workflows.getById(ordersId)!.nodes.find((node) => node.nodeId === "call")!
    expect(call.type === "workflow" ? call.config?.targetWorkflowId : "not a call node").toBeNull()
    expect(store.workflows.getById(loginId)!.collectionId).toBe(projectId)
    expect(store.collections.getById(other.collectionId)!.workflowCount).toBe(0)
    expect(store.collections.getById(projectId)!.workflowCount).toBe(2)
  })

  it("refuses a folder whose ids belong to another workspace", async () => {
    const store = openStore()
    const { projectId } = seedProject(store)
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    const otherWorkspace = store.workspaces.create({ name: "Other", slug: "other" }).workspaceId

    await expect(importProjectFolder(store.projects, otherWorkspace, folder)).rejects.toThrow(/already belong to another workspace/)
  })

  it("refuses an id that is not an APIWeave id, before touching the database", async () => {
    const store = openStore()
    const { projectId } = seedProject(store)
    await exportProjectFolder(store.projects, store.workspaceId, projectId, folder)
    editJson(path.join(folder, PROJECT_FILE), (doc) => {
      (doc["workflows"] as { workflowId: string }[])[0]!.workflowId = "../../evil"
    })

    await expect(importProjectFolder(store.projects, store.workspaceId, folder)).rejects.toThrow(/workflows\.0\.workflowId: must be an APIWeave id/)
    expect(store.workflows.getById("../../evil")).toBeUndefined()
  })
})
