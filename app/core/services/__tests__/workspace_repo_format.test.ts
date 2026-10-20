import fs from "node:fs"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { initDatabase, type InitializedDatabase } from "../../db"
import { generateId } from "../../id"
import { CollectionRepository, EnvironmentRepository, SecretRepository, WorkflowRepository, WorkspaceRepository } from "../../repositories"
import {
  MAX_RECORD_ID_LENGTH,
  RecordIdSchema,
  describeRecordFile,
  parseWorkspace,
  serializeWorkspace,
  workspaceSnapshot,
  type WorkspaceRecords,
  type WorkspaceSnapshot,
} from "../workspace_repo_format"
import type { WorkflowNode } from "@shared/types/WorkflowNode"

const FIXTURE_DIR = path.join(__dirname, "__fixtures__", "workspace-repo")

interface Store {
  readonly db: InitializedDatabase
  readonly workspaces: WorkspaceRepository
  readonly workflows: WorkflowRepository
  readonly environments: EnvironmentRepository
  readonly collections: CollectionRepository
  readonly secrets: SecretRepository
  readonly workspaceId: string
}

const stores: Store[] = []

function openStore(): Store {
  const db = initDatabase({ databasePath: ":memory:" })
  const workspaces = new WorkspaceRepository(db.kvStore)
  const store = {
    db,
    workspaces,
    workflows: new WorkflowRepository(db.kvStore),
    environments: new EnvironmentRepository(db.kvStore),
    collections: new CollectionRepository(db.kvStore),
    secrets: new SecretRepository(db.kvStore),
    workspaceId: workspaces.create({ name: "Acme QA", slug: "acme-qa", description: "Shared API tests" }).workspaceId,
  }
  stores.push(store)
  return store
}

afterEach(() => {
  for (const store of stores.splice(0)) store.db.close()
})

const http = (nodeId: string, url: string, headers: { key: string; value: string }[], x = 240.4): WorkflowNode => ({
  nodeId,
  type: "http-request",
  label: nodeId,
  position: { x, y: 10.6 },
  config: { method: "GET", url, headers },
}) as WorkflowNode

const bearer = [{ key: "Authorization", value: "Bearer {{secrets.API_TOKEN}}" }]

/**
 * A real user-scoped environment row. No repository write reaches `scopeType`,
 * and none should: the workspace CRUD only ever makes workspace-scoped rows.
 * The column exists, so this inserts one the way the schema allows and the
 * workspace paths do not, which is what the snapshot must filter out.
 */
function seedUserEnvironment(store: Store): void {
  store.db.kvStore.set(
    "INSERT INTO environments (id, workspace_id, scopeType, scopeId, name, slug, variables_json, settings_json) VALUES (?, ?, 'user', ?, ?, ?, ?, ?)",
    [
      "env-mine",
      store.workspaceId,
      "usr-owner",
      "Mine",
      "mine",
      JSON.stringify({ region: "us" }),
      JSON.stringify({ description: null, swaggerDocUrl: null, baseEnvironmentId: null, secrets: {}, isDefault: true }),
    ],
  )
}

/**
 * A workspace with everything the format must handle: a project with an order,
 * two workflows named alike (one in no project), a group frame stored after
 * its child, float positions, literal credentials, node templates, an
 * environment with a base, a default flag and stored secrets, and a user-scoped
 * environment that must not reach the tree. Ids are fixed so the golden files are.
 */
function seed(store: Store): void {
  const { workspaceId } = store
  seedUserEnvironment(store)
  store.environments.create({ environmentId: "env-base", workspaceId, name: "Base", variables: { region: "eu" } })
  store.environments.create({
    environmentId: "env-staging",
    workspaceId,
    name: "Staging",
    baseEnvironmentId: "env-base",
    isDefault: true,
    variables: { baseUrl: "https://staging.example.com", apiKey: "literal-key" },
  })
  for (const name of ["ZETA", "API_TOKEN"]) {
    store.secrets.put({ name, scopeType: "environment", scopeId: "env-staging", workspaceId, keyId: "key-1", sealed: new Uint8Array([7, 7, 7]) })
  }
  const project = store.collections.create({ collectionId: "proj-shop", workspaceId, name: "Shop API", color: "#123456" })
  store.workflows.create({
    workflowId: "wf-login",
    workspaceId,
    name: "Login",
    collectionId: project.collectionId,
    selectedEnvironmentId: "env-staging",
    variables: { user: "alice", password: "hunter2" },
    tags: ["smoke"],
    nodes: [
      { nodeId: "z-end", type: "end", position: { x: 900, y: 0 } } as WorkflowNode,
      { ...http("b-child", "{{env.baseUrl}}/login", bearer), parentId: "y-frame" } as WorkflowNode,
      { nodeId: "y-frame", type: "group", position: { x: 100, y: 0 }, config: { width: 400, height: 200 } } as WorkflowNode,
      { nodeId: "a-start", type: "start", position: { x: 0.2, y: 0 } } as WorkflowNode,
    ],
    edges: [
      { edgeId: "e2", source: "b-child", target: "z-end" },
      { edgeId: "e1", source: "a-start", target: "b-child" },
    ],
    // A template carries its own credential, so a golden file proves the tree
    // sanitizes nodeTemplates the way it sanitizes a node's config.
    nodeTemplates: [
      { name: "Login request", config: { method: "GET", url: "{{env.baseUrl}}/login", headers: [{ key: "Authorization", value: "Bearer template-literal-token" }] } },
    ],
  })
  store.workflows.create({
    workflowId: "wf-orders",
    workspaceId,
    name: "Orders / list",
    collectionId: project.collectionId,
    nodes: [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } } as WorkflowNode,
      http("list", "{{env.baseUrl}}/orders?access_token=live-query-token", [{ key: "X-Api-Key", value: "live-literal-token" }]),
    ],
    edges: [{ edgeId: "e1", source: "start", target: "list" }],
  })
  store.workflows.create({ workflowId: "wf-login-copy", workspaceId, name: "Login", nodes: [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } } as WorkflowNode] })
  store.collections.update(project.collectionId, {
    workflowOrder: [
      { workflowId: "wf-login", order: 1, enabled: false, continueOnFail: true },
      { workflowId: "wf-orders", order: 0, enabled: true, continueOnFail: false },
    ],
  })
}

/** What the sync service will hand the format: the workspace's rows, read through its repositories. */
function recordsOf(store: Store): WorkspaceRecords {
  const environments = store.environments.listByWorkspace(store.workspaceId).items
  return {
    workspace: store.workspaces.getById(store.workspaceId)!,
    projects: store.collections.listByWorkspace(store.workspaceId).items,
    workflows: store.workflows.listByWorkspace(store.workspaceId, true).items,
    environments,
  }
}

/** The seeded workspace, with the one generated id (the workspace's own) pinned so the golden files are stable. */
function seededRecords(): WorkspaceRecords {
  const store = openStore()
  seed(store)
  const records = recordsOf(store)
  return { ...records, workspace: { ...records.workspace, workspaceId: "ws-acme" } }
}

function readFixtureTree(): Map<string, string> {
  const files = new Map<string, string>()
  for (const entry of fs.readdirSync(FIXTURE_DIR, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile()) continue
    const full = path.join(entry.parentPath, entry.name)
    files.set(path.relative(FIXTURE_DIR, full).split(path.sep).join("/"), fs.readFileSync(full, "utf8"))
  }
  return files
}

function editJson(files: ReadonlyMap<string, string>, file: string, edit: (doc: Record<string, unknown>) => void): Map<string, string> {
  const doc = JSON.parse(files.get(file)!) as Record<string, unknown>
  edit(doc)
  return new Map([...files, [file, JSON.stringify(doc)]])
}

const reversed = <T,>(items: readonly T[]): T[] => [...items].reverse()

describe("workspace repository format", () => {
  it("writes the golden tree, and reads it back to the same snapshot", async () => {
    const snapshot = workspaceSnapshot(seededRecords())
    const files = serializeWorkspace(snapshot)

    for (const [file, text] of files) await expect(text).toMatchFileSnapshot(path.join(FIXTURE_DIR, file))
    expect([...readFixtureTree().keys()].sort()).toEqual([...files.keys()])
    expect(parseWorkspace(readFixtureTree())).toEqual(snapshot)
  })

  it("lays the tree out flat, one file per record, the id in every name", () => {
    const files = serializeWorkspace(workspaceSnapshot(seededRecords()))

    expect([...files.keys()]).toEqual([
      ".apiweave/format.json",
      ".gitattributes",
      "environments/base--env-base.json",
      "environments/staging--env-staging.json",
      "projects/shop-api--proj-shop.json",
      "workflows/login--wf-login-copy.json",
      "workflows/login--wf-login.json",
      "workflows/orders-list--wf-orders.json",
      "workspace.json",
    ])
    expect(files.get(".apiweave/format.json")).toBe('{\n  "format": "apiweave-workspace",\n  "version": 1\n}\n')
    expect(files.get(".gitattributes")).toBe("* text eol=lf\n")
    for (const text of files.values()) {
      expect(text.endsWith("\n")).toBe(true)
      expect(text).not.toContain("\r")
    }
  })

  it("round-trips a seeded database through files to an identical snapshot", () => {
    const store = openStore()
    seed(store)
    const snapshot = workspaceSnapshot(recordsOf(store))

    expect(parseWorkspace(serializeWorkspace(snapshot))).toEqual(snapshot)
    expect(snapshot.workflows.map((workflow) => [workflow.workflowId, workflow.projectId])).toEqual([
      ["wf-login", "proj-shop"], ["wf-login-copy", null], ["wf-orders", "proj-shop"],
    ])
    expect(snapshot.projects[0]!.workflowOrder).toEqual([
      { workflowId: "wf-orders", enabled: true, continueOnFail: false },
      { workflowId: "wf-login", enabled: false, continueOnFail: true },
    ])
  })

  it("is a fixed point: what it reads, it writes back byte for byte", () => {
    const snapshot = workspaceSnapshot(seededRecords())
    // A snapshot the builder did not normalize: unsorted, unrounded, with a literal credential.
    const raw: WorkspaceSnapshot = {
      ...snapshot,
      workflows: snapshot.workflows.map((workflow) => ({
        ...workflow,
        variables: { ...workflow.variables, token: "live-variable-token" },
        nodes: reversed(workflow.nodes).map((node) => ({ ...(node as Record<string, unknown>), position: { x: 10.4, y: 20.5 } }) as typeof node),
        edges: reversed(workflow.edges),
      })),
    }

    const once = parseWorkspace(serializeWorkspace(raw))
    const twice = parseWorkspace(serializeWorkspace(once))

    expect(twice).toEqual(once)
    expect([...serializeWorkspace(once)]).toEqual([...serializeWorkspace(raw)])
    expect(JSON.stringify(once)).not.toContain("live-variable-token")
  })

  it("round-trips a tree that claims two default environments unchanged", () => {
    const snapshot = workspaceSnapshot(seededRecords())
    const twoDefaults: WorkspaceSnapshot = {
      ...snapshot,
      environments: snapshot.environments.map((environment) => ({ ...environment, isDefault: true })),
    }

    const once = parseWorkspace(serializeWorkspace(twoDefaults))
    const twice = parseWorkspace(serializeWorkspace(once))

    expect(once.environments.filter((environment) => environment.isDefault)).toHaveLength(2)
    expect(twice).toEqual(once)
    expect([...serializeWorkspace(once)]).toEqual([...serializeWorkspace(twoDefaults)])
  })

  it("accepts a literal credential in a file and withholds it the next time it writes", () => {
    const typed = "typed-literal-credential"
    const files = editJson(serializeWorkspace(workspaceSnapshot(seededRecords())), "environments/staging--env-staging.json", (doc) => {
      (doc["variables"] as Record<string, unknown>)["apiKey"] = typed
    })

    const accepted = parseWorkspace(files)
    expect(accepted.environments.find((environment) => environment.environmentId === "env-staging")!.variables["apiKey"]).toBe(typed)

    const healed = serializeWorkspace(accepted)
    expect(healed.get("environments/staging--env-staging.json")).toContain('"apiKey": "<SECRET>"')
    expect([...healed.values()].join("\n")).not.toContain(typed)
  })

  it("writes a workflow's node templates, without the credentials they hold", () => {
    const files = serializeWorkspace(workspaceSnapshot(seededRecords()))
    const login = JSON.parse(files.get("workflows/login--wf-login.json")!) as { nodeTemplates: { name: string; config: { headers: unknown[] } }[] }

    expect(login.nodeTemplates).toEqual([{ name: "Login request", config: { headers: [], method: "GET", url: "{{env.baseUrl}}/login" } }])
    expect(files.get("workflows/login--wf-login.json")).not.toContain("template-literal-token")
  })

  it("writes byte-identical files whatever order its input comes in", () => {
    const records = seededRecords()
    const shuffled: WorkspaceRecords = {
      ...records,
      projects: reversed(records.projects),
      workflows: reversed(records.workflows).map((workflow) => ({ ...workflow, nodes: reversed(workflow.nodes), edges: reversed(workflow.edges) })),
      environments: reversed(records.environments),
    }
    const snapshot = workspaceSnapshot(records)
    const expected = [...serializeWorkspace(snapshot)]

    expect([...serializeWorkspace(workspaceSnapshot(shuffled))]).toEqual(expected)
    expect([...serializeWorkspace({
      ...snapshot,
      workflows: reversed(snapshot.workflows),
      environments: reversed(snapshot.environments),
      projects: reversed(snapshot.projects),
    })]).toEqual(expected)
  })

  it("gives two workflows with the same name distinct paths", () => {
    const files = serializeWorkspace(workspaceSnapshot(seededRecords()))

    expect(JSON.parse(files.get("workflows/login--wf-login.json")!)).toMatchObject({ workflowId: "wf-login", name: "Login" })
    expect(JSON.parse(files.get("workflows/login--wf-login-copy.json")!)).toMatchObject({ workflowId: "wf-login-copy", name: "Login" })
  })

  it("puts a group frame before its children and rounds positions to whole pixels", () => {
    const files = serializeWorkspace(workspaceSnapshot(seededRecords()))
    const login = JSON.parse(files.get("workflows/login--wf-login.json")!) as { nodes: { nodeId: string; position: unknown }[]; edges: { edgeId: string }[] }

    expect(login.nodes.map((node) => node.nodeId)).toEqual(["a-start", "y-frame", "z-end", "b-child"])
    expect(login.nodes.map((node) => node.position)).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 900, y: 0 }, { x: 240, y: 11 }])
    expect(login.edges.map((edge) => edge.edgeId)).toEqual(["e1", "e2"])
  })

  it("never writes secret values, local state or what is not synced; references and secret names stay", () => {
    const records = seededRecords()
    // `env-mine` is a real user-scoped row in the store (`seedUserEnvironment`), read back through the repository.
    expect(records.environments.map((environment) => environment.scopeType)).toContain("user")
    const files = serializeWorkspace(workspaceSnapshot(records))
    const tree = [...files.values()].join("\n")

    for (const literal of ["literal-key", "hunter2", "live-literal-token", "live-query-token", "template-literal-token"]) expect(tree).not.toContain(literal)
    for (const key of ["rev", "createdAt", "updatedAt", "slug", "isPersonal", "deletedAt", "baseEnvironmentId", "secrets", "secretNames", "scopeType", "collectionId", "workflowCount", "order"]) {
      expect(tree).not.toContain(`"${key}"`)
    }
    expect([...files.keys()].filter((file) => file !== "workspace.json").every((file) => !files.get(file)!.includes('"workspaceId"'))).toBe(true)
    expect([...files.keys()].some((file) => file.includes("env-mine"))).toBe(false)
    expect(files.get("workflows/login--wf-login.json")).toContain("Bearer {{secrets.API_TOKEN}}")
    expect(files.get("workflows/login--wf-login.json")).toContain('"password": "<SECRET>"')
    expect(JSON.parse(files.get("environments/staging--env-staging.json")!)).toMatchObject({
      isDefault: true,
      variables: { baseUrl: "https://staging.example.com", apiKey: "<SECRET>" },
    })
    expect(JSON.parse(files.get("environments/base--env-base.json")!)).toMatchObject({ isDefault: false })
  })

  it("refuses a secret-storage field anywhere in the tree, on the way out and on the way in", () => {
    const snapshot = workspaceSnapshot(seededRecords())
    const leaking: WorkspaceSnapshot = {
      ...snapshot,
      workflows: snapshot.workflows.map((workflow) =>
        (workflow.workflowId === "wf-orders" ? { ...workflow, edges: [{ ...(workflow.edges[0] as Record<string, string>), ciphertext: "c2VjcmV0" }] } : workflow)),
    }
    expect(() => serializeWorkspace(leaking)).toThrow(/forbidden secret field 'ciphertext' at 'workflows\/orders-list--wf-orders\.json\.edges\[0\]'/)

    const files = editJson(serializeWorkspace(snapshot), "environments/staging--env-staging.json", (doc) => {
      (doc["variables"] as Record<string, unknown>)["nested"] = { ciphertext: "c2VjcmV0" }
    })
    expect(() => parseWorkspace(files)).toThrow(/environments\/staging--env-staging\.json: .*forbidden secret field 'ciphertext'/)
  })
})

describe("reading a workspace repository", () => {
  const tree = (): Map<string, string> => serializeWorkspace(workspaceSnapshot(seededRecords()))

  it("ignores files that are not the format's own", () => {
    const files = new Map([...tree(), ["README.md", "# API tests\n"], [".github/workflows/ci.yml", "on: push\n"], [".apiweave/notes.txt", "x"]])

    expect(parseWorkspace(files)).toEqual(parseWorkspace(tree()))
  })

  it.each([
    "../outside.json",
    "workflows/../../outside.json",
    "/etc/passwd",
    "C:/Users/me/x.json",
    "workflows\\login--wf-x.json",
    "a//b.json",
    "./workspace.json",
  ])("refuses the path %j, which leaves the tree", (file) => {
    expect(() => parseWorkspace(new Map([...tree(), [file, "{}"]]))).toThrow(/a repository path must be relative, '\/'-separated and stay inside the repository/)
  })

  it("refuses an oversized file, and an oversized tree", () => {
    expect(() => parseWorkspace(new Map([...tree(), ["docs/big.txt", "x".repeat(10 * 1024 * 1024 + 1)]]))).toThrow(/docs\/big\.txt is 10485761 bytes; a repository file may be at most 10485760/)

    const part = "x".repeat(10 * 1024 * 1024)
    const parts = Array.from({ length: 10 }, (_, index): [string, string] => [`docs/part-${index}.txt`, part])
    // The tenth part is the file that crosses the cumulative limit, and the error names it.
    expect(() => parseWorkspace(new Map([...tree(), ...parts]))).toThrow(/docs\/part-9\.txt pushes the repository over its 104857600-byte limit/)
  })

  it("refuses a name or description over its length limit, for the workspace and every record", () => {
    const files = tree()
    const tooLongName = "n".repeat(201)
    const tooLongDescription = "d".repeat(2001)

    expect(() => parseWorkspace(editJson(files, "workspace.json", (doc) => {
      doc["name"] = tooLongName
    }))).toThrow(/workspace\.json: name: a name may be at most 200 characters/)
    expect(() => parseWorkspace(editJson(files, "workspace.json", (doc) => {
      doc["description"] = tooLongDescription
    }))).toThrow(/workspace\.json: description: a description may be at most 2000 characters/)
    expect(() => parseWorkspace(editJson(files, "projects/shop-api--proj-shop.json", (doc) => {
      doc["name"] = tooLongName
    }))).toThrow(/projects\/shop-api--proj-shop\.json: name: a name may be at most 200 characters/)
    expect(() => parseWorkspace(editJson(files, "environments/staging--env-staging.json", (doc) => {
      doc["description"] = tooLongDescription
    }))).toThrow(/environments\/staging--env-staging\.json: description: a description may be at most 2000 characters/)
    expect(() => parseWorkspace(editJson(files, "workflows/login--wf-login.json", (doc) => {
      doc["description"] = tooLongDescription
    }))).toThrow(/workflows\/login--wf-login\.json: description: a description may be at most 2000 characters/)
  })

  it.each(["NUL", "con", "Aux", "prn", "COM1", "lpt9", "com0"])("refuses the Windows device name %s as an id, saying why", (id) => {
    expect(() => parseWorkspace(editJson(tree(), "workspace.json", (doc) => {
      doc["workspaceId"] = id
    }))).toThrow(/workspace\.json: workspaceId: must be an APIWeave id, not a name Windows reserves for a device/)
  })

  it("accepts an id that only starts like a device name", () => {
    for (const id of ["NULL", "console", "COM10", "lpt-1", "aux_files"]) {
      expect(parseWorkspace(editJson(tree(), "workspace.json", (doc) => {
        doc["workspaceId"] = id
      })).workspace.workspaceId).toBe(id)
    }
  })

  it("caps an id's length far above the ids the app generates", () => {
    expect(RecordIdSchema.safeParse(generateId()).success).toBe(true)
    expect(RecordIdSchema.safeParse("a".repeat(MAX_RECORD_ID_LENGTH)).success).toBe(true)
    expect(() => parseWorkspace(editJson(tree(), "workspace.json", (doc) => {
      doc["workspaceId"] = "a".repeat(MAX_RECORD_ID_LENGTH + 1)
    }))).toThrow(/workspace\.json: workspaceId: must be an APIWeave id of at most 128 characters/)
  })

  it("refuses to write a name or description over its length limit too", () => {
    const snapshot = workspaceSnapshot(seededRecords())

    expect(() => serializeWorkspace({ ...snapshot, workspace: { ...snapshot.workspace, name: "n".repeat(201) } }))
      .toThrow(/workspace\.json: name: a name may be at most 200 characters/)
  })

  it("refuses a repository that is not one, or one a newer APIWeave wrote", () => {
    const files = tree()
    files.delete(".apiweave/format.json")
    expect(() => parseWorkspace(files)).toThrow(/\.apiweave\/format\.json is missing: this is not an APIWeave workspace repository/)

    expect(() => parseWorkspace(editJson(tree(), ".apiweave/format.json", (doc) => {
      doc["format"] = "apiweave-project"
    }))).toThrow(/\.apiweave\/format\.json: format: this is not an APIWeave workspace repository/)
    expect(() => parseWorkspace(editJson(tree(), ".apiweave/format.json", (doc) => {
      doc["version"] = 2
    }))).toThrow(/written by a newer APIWeave .*update APIWeave/)
  })

  it("refuses a file that does not match its schema, naming the file", () => {
    const workflow = "workflows/login--wf-login.json"
    expect(() => parseWorkspace(new Map([...tree(), [workflow, "<<<<<<< HEAD\n"]]))).toThrow(/login--wf-login\.json is not valid JSON \(an unresolved merge conflict\?\)/)
    expect(() => parseWorkspace(editJson(tree(), workflow, (doc) => {
      doc["rev"] = 3
    }))).toThrow(/workflows\/login--wf-login\.json: Unrecognized key/)
    expect(() => parseWorkspace(editJson(tree(), workflow, (doc) => {
      (doc["nodes"] as Record<string, unknown>[])[0]!["type"] = "teleport"
    }))).toThrow(/workflows\/login--wf-login\.json: nodes\.0/)
    expect(() => parseWorkspace(editJson(tree(), "projects/shop-api--proj-shop.json", (doc) => {
      (doc["workflowOrder"] as Record<string, unknown>[])[0]!["workflowId"] = "../../evil"
    }))).toThrow(/workflowOrder\.0\.workflowId: must be an APIWeave id/)
    expect(() => parseWorkspace(editJson(tree(), "projects/shop-api--proj-shop.json", (doc) => {
      (doc["workflowOrder"] as Record<string, unknown>[])[0]!["workflowId"] = "-c"
    }))).toThrow(/workflowOrder\.0\.workflowId: must be an APIWeave id .*not starting with '-'/)
  })

  it("refuses a record file not named after its id, in a subfolder, or sharing its id with another", () => {
    const files = tree()
    const login = files.get("workflows/login--wf-login.json")!

    expect(() => parseWorkspace(new Map([...files, ["workflows/login--wf-other.json", login]]))).toThrow(/must be named <name>--wf-login\.json/)
    expect(() => parseWorkspace(new Map([...files, ["workflows/sign-in--wf-login.json", login]]))).toThrow(/id wf-login is held by two files/)
    expect(() => parseWorkspace(new Map([...files, ["workflows/archive/login--wf-login.json", login]]))).toThrow(/not in subfolders/)
  })

  it("refuses to write an id that cannot name a file", () => {
    const snapshot = workspaceSnapshot(seededRecords())

    expect(() => serializeWorkspace({ ...snapshot, workflows: [{ ...snapshot.workflows[0]!, workflowId: "../../evil" }] })).toThrow(/'\.\.\/\.\.\/evil' is not an APIWeave id/)
  })

  it("says which record a single file holds, and nothing for the files that are not a record's", () => {
    const files = tree()
    const describe = (path: string) => describeRecordFile(path, files.get(path) ?? "")

    expect(describe("workspace.json")).toEqual({ kind: "workspace", id: expect.any(String), name: "Acme QA" })
    expect(describe("workflows/login--wf-login.json")).toEqual({ kind: "workflow", id: "wf-login", name: "Login" })
    expect(describe("projects/shop-api--proj-shop.json")).toMatchObject({ kind: "project", id: "proj-shop" })
    const environment = [...files.keys()].find((path) => path.startsWith("environments/"))!
    expect(describe(environment)).toMatchObject({ kind: "environment" })
    for (const path of [".apiweave/format.json", ".gitattributes", "README.md", "workflows/archive/login--wf-login.json", "workflows/notes.txt"]) {
      expect(describeRecordFile(path, files.get(path) ?? "anything")).toBeUndefined()
    }
  })

  it("refuses a record file that does not read, naming it", () => {
    expect(() => describeRecordFile("workflows/login--wf-login.json", "<<<<<<< HEAD\n")).toThrow(/login--wf-login\.json is not valid JSON/)
    expect(() => describeRecordFile("projects/shop-api--proj-shop.json", "{}")).toThrow(/projects\/shop-api--proj-shop\.json/)
  })
})
