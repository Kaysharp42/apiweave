import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { WorkflowSchema } from "@shared/zod-schemas"
import {
  canonicalizeWorkflowGraph,
  CANONICAL_KV_FIELDS,
} from "../../../repositories/helpers"
import { WorkflowRepository } from "../../../repositories"
import { WorkspaceRepository } from "../../../repositories"
import { initDatabase, type InitializedDatabase } from "../../../db"
import { canonicalizeExistingWorkflows } from "../../../db/canonicalize_existing_workflows"

// Regression for the renderer-side error that surfaced as
// "SidebarStore: workflows fetch returned non-OK status 500". Output
// validation (WorkflowSchema.parse) re-throws ZodError outside
// IpcRouter.dispatch's try/catch by design, and the renderer mapped the
// rejection to HTTP-500. The stored http-request nodes carried
// headers/cookies/queryParams/pathVariables as `string` or
// `Record<string,string>` (or partial arrays) — none of which the strict
// schema (now keyed by `KeyValuePair[]`) accepts.
//
// The fix is layered:
//   1. canonicalizeWorkflowGraph lifts any legacy shape to KeyValuePair[].
//   2. WorkflowSchema is strict so a leak stays visible (rejects Record /
//      string / partial-array straight).
//   3. WorkflowRepository.create coerces nodes on the way to disk so the
//      import path (which bypasses per-handler input validation) cannot
//      poison the next read.
//   4. canonicalizeExistingWorkflows rewrites on-disk rows in place and is
//      idempotent (run on every startup; legacy rows flip canonical on the
//      first start after this lands, subsequent starts are a no-op).

const WORKSPACE_ID = "01KWXR7BRX8EQGG8Y9WA3A5V2J"

let db: InitializedDatabase

beforeEach(() => {
  db = initDatabase({ databasePath: ":memory:" })
})

afterEach(() => db.close())

function workflow(nodes: unknown) {
  return {
    workflowId: "w",
    workspaceId: WORKSPACE_ID,
    name: "wf",
    nodes,
    edges: [],
    variables: {},
    tags: [],
    nodeTemplates: [],
    rev: 1,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }
}

function canonical(nodes: unknown) {
  return canonicalizeWorkflowGraph({ nodes, edges: [] } as never) as {
    nodes: unknown[]
  }
}

describe("canonicalizeWorkflowGraph — lifts legacy KV shapes to KeyValuePair[]", () => {
  for (const field of CANONICAL_KV_FIELDS) {
    it(`${field}: string \`"key=value\\nkey2=value2"\` → KeyValuePair[]`, () => {
      const graph = canonical([
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: { method: "POST", url: "https://x", [field]: "Accept=*/*\nX-Test=yes" },
        },
      ])

      const parsed = WorkflowSchema.safeParse(workflow(graph.nodes))
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true)
      if (!parsed.success) return
      const cfg = (parsed.data.nodes[0] as { config?: Record<string, unknown> }).config
      expect(cfg?.[field]).toEqual([
        { key: "Accept", value: "*/*" },
        { key: "X-Test", value: "yes" },
      ])
    })

    it(`${field}: Record<string,string> → KeyValuePair[] (preserves key order)`, () => {
      const graph = canonical([
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: { method: "GET", url: "https://x", [field]: { Accept: "*/*", Foo: "bar" } },
        },
      ])

      const parsed = WorkflowSchema.safeParse(workflow(graph.nodes))
      expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true)
      if (!parsed.success) return
      const cfg = (parsed.data.nodes[0] as { config?: Record<string, unknown> }).config
      expect(cfg?.[field]).toEqual([
        { key: "Accept", value: "*/*" },
        { key: "Foo", value: "bar" },
      ])
    })

    it(`${field}: already-canonical KeyValuePair[] is unchanged (idempotent)`, () => {
      const nodes = [
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: {
            method: "GET",
            url: "https://x",
            [field]: [
              { key: "Accept", value: "*/*" },
              { key: "Disabled", value: "no", active: false },
            ],
          },
        },
      ]
      const graphObj = { nodes, edges: [] }
      const result = canonicalizeWorkflowGraph(graphObj as never)

      expect(result).toBe(graphObj as never) // SAME reference — no write needed
      expect(WorkflowSchema.safeParse(workflow(nodes)).success).toBe(true)
    })
  }

  it("leaves non-http nodes untouched (no KV fields belong on them)", () => {
    const nodes = [
      { nodeId: "start", type: "start", position: { x: 0, y: 0 } },
      { nodeId: "delay", type: "delay", position: { x: 1, y: 1 }, config: { duration: 250 } },
    ]
    const graphObj = { nodes, edges: [] }
    const result = canonicalizeWorkflowGraph(graphObj as never)
    expect(result).toBe(graphObj as never)
  })
})

describe("WorkflowSchema — strictness (bug stays visible until migration runs)", () => {
  it("rejects Record<string,string> headers straight", () => {
    const parsed = WorkflowSchema.safeParse(
      workflow([
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: { method: "GET", url: "https://x", headers: { Accept: "*/*" } },
        },
      ]),
    )
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join(".") === "nodes.0.config.headers")).toBe(true)
    }
  })

  it("rejects string headers straight", () => {
    const parsed = WorkflowSchema.safeParse(
      workflow([
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: { method: "GET", url: "https://x", headers: "Accept=*/*" },
        },
      ]),
    )
    expect(parsed.success).toBe(false)
  })

  it("rejects an unknown node type", () => {
    const parsed = WorkflowSchema.safeParse(
      workflow([
        { nodeId: "n", type: "magic", position: { x: 0, y: 0 }, config: {} },
      ]),
    )
    expect(parsed.success).toBe(false)
  })

  it("rejects a delay node smuggle of a headers field (discriminated union)", () => {
    const parsed = WorkflowSchema.safeParse(
      workflow([
        {
          nodeId: "n",
          type: "delay",
          position: { x: 0, y: 0 },
          config: { duration: 1000, headers: [{ key: "Accept", value: "*/*" }] },
        },
      ]),
    )
    expect(parsed.success).toBe(false)
    if (!parsed.success) {
      expect(parsed.error.issues.some((i) => i.path.join(".").startsWith("nodes.0.config"))).toBe(true)
    }
  })

  it("accepts a plain http-request node with all KV fields as KeyValuePair[]", () => {
    const parsed = WorkflowSchema.safeParse(
      workflow([
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: {
            method: "POST",
            url: "https://x",
            headers: [{ key: "Accept", value: "*/*" }],
            cookies: [{ key: "sid", value: "abc", active: true }],
            queryParams: [{ key: "page", value: "1" }],
            pathVariables: [{ key: "id", value: "12" }],
            body: "{}",
            bodyType: "json" as const,
            timeout: 30,
            extractors: { token: "response.body.token" },
          },
        },
      ]),
    )
    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true)
  })

  it("runtime canvas state (executionStatus/branchCount) is NOT on the persisted node", () => {
    const parsed = WorkflowSchema.safeParse(
      workflow([
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: { method: "GET", url: "https://x" },
          // canvas-side fields mixed into the persisted node should now be rejected
          executionStatus: "success",
          branchCount: 2,
        } as never,
      ]),
    )
    expect(parsed.success).toBe(false)
  })
})

describe("WorkflowRepository — coerces legacy input on the trust boundary", () => {
  it("create persists a Record-headers node so the strict schema parses on re-read", () => {
    const workspaces = new WorkspaceRepository(db.kvStore)
    const workflows = new WorkflowRepository(db.kvStore)
    workspaces.create({ name: "Personal", slug: "personal" })
    const workspace = workspaces.listAll()[0]!

    const created = workflows.create({
      workspaceId: workspace.workspaceId,
      name: "Actor Module",
      nodes: [
        {
          nodeId: "login",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: {
            method: "POST",
            url: "{{env.BASE_URL}}/auth/authenticate",
            headers: { Accept: "*/*", "Content-Type": "application/json" },
            cookies: "sid=abc",
          },
        } as never,
      ] as never,
      edges: [],
    })

    const reread = workflows.listByWorkspace(workspace.workspaceId, true).items[0]!
    const parsed = WorkflowSchema.safeParse({
      ...reread,
      nodes: reread.nodes as never,
      edges: reread.edges as never,
      rev: created.rev,
    })

    expect(parsed.success, parsed.success ? "" : JSON.stringify(parsed.error.issues)).toBe(true)
    if (!parsed.success) return
    const cfg = (parsed.data.nodes[0] as { config?: Record<string, unknown> }).config
    expect(Array.isArray(cfg?.["headers"])).toBe(true)
    expect(cfg?.["cookies"]).toEqual([{ key: "sid", value: "abc" }])
  })
})

describe("canonicalizeExistingWorkflows — idempotent on-disk rewrite", () => {
  it("rewrites legacy rows on the first pass and is a no-op on subsequent passes", () => {
    const workspaces = new WorkspaceRepository(db.kvStore)
    workspaces.create({ name: "Personal", slug: "personal" })
    const workspace = workspaces.listAll()[0]!

    const legacyJson = JSON.stringify({
      nodes: [
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: {
            method: "GET",
            url: "https://x",
            headers: { Accept: "*/*" },
            cookies: "sid=abc",
          },
        },
        { nodeId: "e", type: "end", position: { x: 100, y: 0 } },
      ],
      edges: [],
    })
    db.kvStore.set(
      "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}')",
      [
        "wf-legacy",
        workspace.workspaceId,
        workspace.workspaceId,
        "Legacy",
        "legacy",
        legacyJson,
      ],
    )

    const first = canonicalizeExistingWorkflows(db.kvStore)
    expect(first).toBe(1)

    const row = db.kvStore.get<{ graph_json: string }>(
      "SELECT graph_json FROM workflows WHERE id = ?",
      ["wf-legacy"],
    )!
    const written = JSON.parse(row.graph_json) as { nodes: { config: Record<string, unknown> }[] }
    const cfg = written.nodes[0].config
    expect(cfg.headers).toEqual([{ key: "Accept", value: "*/*" }])
    expect(cfg.cookies).toEqual([{ key: "sid", value: "abc" }])

    const second = canonicalizeExistingWorkflows(db.kvStore)
    expect(second).toBe(0)
  })

  it("already-canonical rows are a no-op", () => {
    const workspaces = new WorkspaceRepository(db.kvStore)
    workspaces.create({ name: "Personal", slug: "personal" })
    const workspace = workspaces.listAll()[0]!

    const canonicalJson = JSON.stringify({
      nodes: [
        {
          nodeId: "n",
          type: "http-request",
          position: { x: 0, y: 0 },
          config: {
            method: "GET",
            url: "https://x",
            headers: [{ key: "Accept", value: "*/*" }],
          },
        },
        { nodeId: "d", type: "delay", position: { x: 100, y: 0 }, config: { duration: 500 } },
      ],
      edges: [],
    })
    db.kvStore.set(
      "INSERT INTO workflows (id, workspace_id, scopeId, name, slug, graph_json, variables_json, settings_json) VALUES (?, ?, ?, ?, ?, ?, '{}', '{}')",
      [
        "wf-clean",
        workspace.workspaceId,
        workspace.workspaceId,
        "Clean",
        "clean",
        canonicalJson,
      ],
    )

    const touched = canonicalizeExistingWorkflows(db.kvStore)
    expect(touched).toBe(0)
  })
})