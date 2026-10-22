import { describe, expect, it } from "vitest"
import { computeConflictDiff, humanizePath } from "../conflict-diff"

/**
 * A diff between two copies of one record's file document, as the merge page
 * asks for it: what a side changed relative to the ancestor it shares. `before`
 * is the ancestor, `after` the copy being described.
 */
describe("computeConflictDiff", () => {
  it("reports nothing for identical documents", () => {
    const document = { workspaceId: "ws_01", name: "Acme", description: null }

    expect(computeConflictDiff("workspace", document, { ...document })).toEqual([])
  })

  it("reports a scalar change with what each side holds", () => {
    const diff = computeConflictDiff("workspace", { workspaceId: "ws_01", name: "Acme", description: null }, { workspaceId: "ws_01", name: "Acme QA", description: null })

    expect(diff).toEqual([{ path: "name", kind: "change", before: "Acme", after: "Acme QA", label: "Name" }])
  })

  it("reports a key only one side holds as added or removed", () => {
    expect(computeConflictDiff("workspace", { name: "Acme" }, { name: "Acme", description: "API tests" })).toEqual([
      { path: "description", kind: "add", before: undefined, after: "API tests", label: "Description" },
    ])
    expect(computeConflictDiff("workspace", { name: "Acme", description: "API tests" }, { name: "Acme" })).toEqual([
      { path: "description", kind: "remove", before: "API tests", after: undefined, label: "Description" },
    ])
  })

  it("recurses into a variable's nested object", () => {
    const base = { environmentId: "env_1", variables: { token: { kind: "bearer", name: "old" } } }
    const changed = { environmentId: "env_1", variables: { token: { kind: "bearer", name: "new" } } }

    expect(computeConflictDiff("environment", base, changed)).toEqual([
      { path: "variables.token.name", kind: "change", before: "old", after: "new", label: 'Variable "token" · Name' },
    ])
  })

  it("reports an array the format does not key as one value", () => {
    const base = { workflowId: "wf_1", nodeTemplates: [{ name: "A" }] }
    const changed = { workflowId: "wf_1", nodeTemplates: [{ name: "B" }] }

    expect(computeConflictDiff("workflow", base, changed)).toEqual([
      { path: "nodeTemplates", kind: "change", before: [{ name: "A" }], after: [{ name: "B" }], label: "Node templates" },
    ])
  })
})

describe("computeConflictDiff — a workflow's keyed arrays", () => {
  const node = (nodeId: string, extra: Record<string, unknown> = {}) => ({ nodeId, type: "http-request", position: { x: 0, y: 0 }, ...extra })

  it("reports an added node", () => {
    const diff = computeConflictDiff("workflow", { nodes: [node("n1")], edges: [] }, { nodes: [node("n1"), node("n2")], edges: [] })

    expect(diff).toEqual([{ path: "nodes.n2", kind: "add", before: undefined, after: node("n2"), label: 'Node "n2"' }])
  })

  it("reports a removed node", () => {
    const diff = computeConflictDiff("workflow", { nodes: [node("n1"), node("n2")], edges: [] }, { nodes: [node("n1")], edges: [] })

    expect(diff).toEqual([{ path: "nodes.n2", kind: "remove", before: node("n2"), after: undefined, label: 'Node "n2"' }])
  })

  it("reports a field change inside a node, scoped under its id", () => {
    const base = { nodes: [node("n1", { config: { method: "GET" } })], edges: [] }
    const changed = { nodes: [node("n1", { config: { method: "POST" } })], edges: [] }

    expect(computeConflictDiff("workflow", base, changed)).toEqual([
      { path: "nodes.n1.config.method", kind: "change", before: "GET", after: "POST", label: 'Node "n1" · Config › Method' },
    ])
  })

  it("diffs edges by edgeId, independently of nodes", () => {
    const base = { nodes: [], edges: [{ edgeId: "e1", source: "n1", target: "n2" }] }
    const changed = { nodes: [], edges: [{ edgeId: "e1", source: "n1", target: "n3" }] }

    expect(computeConflictDiff("workflow", base, changed)).toEqual([
      { path: "edges.e1.target", kind: "change", before: "n2", after: "n3", label: 'Edge "e1" · Target' },
    ])
  })

  it("is order-independent for nodes and edges, by id", () => {
    const first = { nodes: [node("n1"), node("n2")], edges: [{ edgeId: "e1", source: "n1", target: "n2" }, { edgeId: "e2", source: "n2", target: "n1" }] }
    const second = { nodes: [node("n2"), node("n1")], edges: [{ edgeId: "e2", source: "n2", target: "n1" }, { edgeId: "e1", source: "n1", target: "n2" }] }

    expect(computeConflictDiff("workflow", first, second)).toEqual([])
  })

  it("reports tags added, removed and reordered by tag", () => {
    expect(computeConflictDiff("workflow", { tags: ["smoke"] }, { tags: ["smoke", "slow"] })).toEqual([
      { path: "tags.slow", kind: "add", before: undefined, after: "slow", label: 'Tag "slow"' },
    ])
    expect(computeConflictDiff("workflow", { tags: ["smoke", "slow"] }, { tags: ["slow", "smoke"] })).toEqual([
      { path: "tags", kind: "change", before: ["smoke", "slow"], after: ["slow", "smoke"], label: "Tags" },
    ])
  })

  it("still diffs every other field of a workflow generically", () => {
    expect(computeConflictDiff("workflow", { name: "Old" }, { name: "New" })).toEqual([
      { path: "name", kind: "change", before: "Old", after: "New", label: "Name" },
    ])
  })
})

describe("computeConflictDiff — a project's workflow order", () => {
  const entry = (workflowId: string, enabled = true) => ({ workflowId, enabled, continueOnFail: false })

  it("diffs the order item by item, by workflow id", () => {
    const diff = computeConflictDiff("project", { workflowOrder: [entry("wf_a")] }, { workflowOrder: [entry("wf_a", false), entry("wf_b")] })

    expect(diff).toEqual([
      { path: "workflowOrder.wf_a.enabled", kind: "change", before: true, after: false, label: 'Workflow "wf_a" · Enabled' },
      { path: "workflowOrder.wf_b", kind: "add", before: undefined, after: entry("wf_b"), label: 'Workflow "wf_b"' },
    ])
  })

  it("reports a reorder at the list's path", () => {
    const diff = computeConflictDiff("project", { workflowOrder: [entry("wf_a"), entry("wf_b")] }, { workflowOrder: [entry("wf_b"), entry("wf_a")] })

    expect(diff).toEqual([
      { path: "workflowOrder", kind: "change", before: ["wf_a", "wf_b"], after: ["wf_b", "wf_a"], label: "Workflow order" },
    ])
  })
})

describe("humanizePath", () => {
  it("splits camelCase and separators into spaced, capitalized segments", () => {
    expect(humanizePath("workflowCount")).toBe("Workflow count")
    expect(humanizePath("variables.apiKey.reference")).toBe('Variable "apiKey" · Reference')
    expect(humanizePath("")).toBe("(entire record)")
  })

  it("reads a path with the merge's escaping: a dot in a key stays in that key", () => {
    expect(humanizePath("variables.api\\.key")).toBe('Variable "api.key"')
  })

  it("names a keyed item by its kind and key", () => {
    expect(humanizePath("nodes.n1.config.method")).toBe('Node "n1" · Config › Method')
    expect(humanizePath("edges.e7")).toBe('Edge "e7"')
  })
})
