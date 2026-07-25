import { describe, expect, it } from "vitest"
import { computeConflictDiff, humanizePath } from "../conflict-diff/diff"

describe("computeConflictDiff — generic kinds", () => {
  it("reports no entries for canonically identical payloads", () => {
    const local = { name: "Dev", workspaceId: "ws-local", rev: 3, updatedAt: "2026-07-25T00:00:00.000Z" }
    const cloud = { name: "Dev", workspaceId: "ws-cloud", rev: 4, updatedAt: "2026-07-25T01:00:00.000Z" }
    expect(computeConflictDiff("workspace", local, cloud)).toEqual([])
  })

  it("reports a change entry with before=cloud, after=local", () => {
    const diff = computeConflictDiff("workspace", { name: "Local name" }, { name: "Cloud name" })
    expect(diff).toEqual([{ path: "name", kind: "change", before: "Cloud name", after: "Local name", label: "Name" }])
  })

  it("reports add/remove for keys present on only one side", () => {
    const diff = computeConflictDiff("project", { name: "x", note: "local only" }, { name: "x" })
    expect(diff).toEqual([{ path: "note", kind: "add", before: undefined, after: "local only", label: "Note" }])
  })

  it("recurses into nested objects for a dotted path", () => {
    const diff = computeConflictDiff(
      "environment",
      { secrets: { apiKey: { reference: "project:col-1:apiKey" } } },
      { secrets: { apiKey: { reference: "project:col-1:oldKey" } } },
    )
    expect(diff).toEqual([
      { path: "secrets.apiKey.reference", kind: "change", before: "project:col-1:oldKey", after: "project:col-1:apiKey", label: "Secrets › Api key › Reference" },
    ])
  })

  it("treats a non-workflow array as an opaque value", () => {
    const diff = computeConflictDiff("project", { workflowOrder: ["a", "c"] }, { workflowOrder: ["a", "b"] })
    expect(diff).toEqual([{ path: "workflowOrder", kind: "change", before: ["a", "b"], after: ["a", "c"], label: "Workflow order" }])
  })
})

describe("computeConflictDiff — workflow", () => {
  const baseNode = (nodeId: string, extra: Record<string, unknown> = {}) => ({
    nodeId,
    type: "http-request",
    position: { x: 0, y: 0 },
    ...extra,
  })

  it("reports an added node", () => {
    const cloud = { nodes: [baseNode("n1")], edges: [] }
    const local = { nodes: [baseNode("n1"), baseNode("n2")], edges: [] }
    const diff = computeConflictDiff("workflow", local, cloud)
    expect(diff).toEqual([{ path: "nodes.n2", kind: "add", before: undefined, after: baseNode("n2"), label: 'Node "n2" added' }])
  })

  it("reports a removed node", () => {
    const cloud = { nodes: [baseNode("n1"), baseNode("n2")], edges: [] }
    const local = { nodes: [baseNode("n1")], edges: [] }
    const diff = computeConflictDiff("workflow", local, cloud)
    expect(diff).toEqual([{ path: "nodes.n2", kind: "remove", before: baseNode("n2"), after: undefined, label: 'Node "n2" removed' }])
  })

  it("reports a field-level change on a node config, scoped under the node id", () => {
    const cloud = { nodes: [baseNode("n1", { config: { method: "GET" } })], edges: [] }
    const local = { nodes: [baseNode("n1", { config: { method: "POST" } })], edges: [] }
    const diff = computeConflictDiff("workflow", local, cloud)
    expect(diff).toEqual([
      { path: "nodes.n1.config.method", kind: "change", before: "GET", after: "POST", label: 'Node "n1" · Config › Method' },
    ])
  })

  it("diffs edges by edgeId independently of nodes", () => {
    const cloud = { nodes: [], edges: [{ edgeId: "e1", source: "n1", target: "n2" }] }
    const local = { nodes: [], edges: [{ edgeId: "e1", source: "n1", target: "n3" }] }
    const diff = computeConflictDiff("workflow", local, cloud)
    expect(diff).toEqual([{ path: "edges.e1.target", kind: "change", before: "n2", after: "n3", label: 'Edge "e1" · Target' }])
  })

  it("still diffs non-nodes/edges top-level fields generically", () => {
    const cloud = { nodes: [], edges: [], name: "Old" }
    const local = { nodes: [], edges: [], name: "New" }
    const diff = computeConflictDiff("workflow", local, cloud)
    expect(diff).toEqual([{ path: "name", kind: "change", before: "Old", after: "New", label: "Name" }])
  })

  it("returns nothing when nodes/edges are identical (order-independent by id)", () => {
    const cloud = { nodes: [baseNode("n1"), baseNode("n2")], edges: [] }
    const local = { nodes: [baseNode("n2"), baseNode("n1")], edges: [] }
    expect(computeConflictDiff("workflow", local, cloud)).toEqual([])
  })
})

describe("humanizePath", () => {
  it("splits camelCase and separators into spaced, capitalized segments", () => {
    expect(humanizePath("workflowCount")).toBe("Workflow count")
    expect(humanizePath("secrets.apiKey.reference")).toBe("Secrets › Api key › Reference")
    expect(humanizePath("")).toBe("(entire record)")
  })
})
