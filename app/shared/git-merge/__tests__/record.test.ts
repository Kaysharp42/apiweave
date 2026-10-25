import { describe, expect, it } from "vitest"
import type { GitMergePick } from "../../types/GitMergePick"
import type { GitMergeSide } from "../../types/GitMergeSide"
import type { JsonValue } from "../../types/JsonValue"
import { mergeRecord, readRecord } from "../record"
import { edge, environment, frame, node, project, workflow, type Json, type WorkflowFile } from "./trees"

const pick = (path: string, side: GitMergeSide, recordId = "wf1"): GitMergePick => ({ recordId, path, side })

/** A workflow as its file holds it, which is how a merge takes its copies. */
function canonical(value: WorkflowFile): Json {
  const read = readRecord("workflow", value)
  if (!("document" in read)) throw new Error(read.invalid)
  return read.document
}

function flow(fields: Partial<WorkflowFile> = {}): WorkflowFile {
  return workflow("wf1", { name: "Login", ...fields })
}

/** A workflow with a start and three delays in a row, edges between them. */
function chain(fields: Partial<WorkflowFile> = {}): WorkflowFile {
  return flow({
    nodes: [{ nodeId: "a", type: "start", position: { x: 0, y: 0 } }, node("n1", 200, 0), node("n2", 400, 0), node("n3", 600, 0)],
    edges: [edge("e1", "a", "n1"), edge("e2", "n1", "n2"), edge("e3", "n2", "n3")],
    ...fields,
  })
}

const merge = (base: Json | undefined, ours: Json | undefined, theirs: Json | undefined, picks: GitMergePick[] = []) =>
  mergeRecord("workflow", base, ours, theirs, picks)

function nodesOf(merged: Json | undefined): Json[] {
  return (merged?.["nodes"] ?? []) as Json[]
}

function nodeOf(merged: Json | undefined, nodeId: string): Json | undefined {
  return nodesOf(merged).find((item) => item["nodeId"] === nodeId)
}

function edgeIds(merged: Json | undefined): unknown[] {
  return ((merged?.["edges"] ?? []) as Json[]).map((item) => item["edgeId"])
}

const moved = (base: WorkflowFile, nodeId: string, position: { x: number; y: number }, fields: Json = {}): WorkflowFile => ({
  ...base,
  nodes: base.nodes.map((item) => ((item as Json)["nodeId"] === nodeId ? { ...(item as Json), position, ...fields } : item)),
})

describe("a scalar", () => {
  it.each([
    ["unchanged in both copies", "Login", "Login", "Login", "Login"],
    ["changed in your copy", "Login", "Sign in", "Login", "Sign in"],
    ["changed in the remote copy", "Login", "Login", "Log in", "Log in"],
    ["changed alike in both copies", "Login", "Sign in", "Sign in", "Sign in"],
  ])("%s: no conflict", (_, base, ours, theirs, expected) => {
    const result = merge(flow({ name: base }), flow({ name: ours }), flow({ name: theirs }))

    expect(result.merged?.["name"]).toBe(expected)
    expect(result.conflicts).toEqual([])
  })

  it("changed differently in both copies is a conflict at its path, the remote copy's value standing for now", () => {
    const result = merge(flow({ name: "Login" }), flow({ name: "Sign in" }), flow({ name: "Log in" }))

    expect(result.merged?.["name"]).toBe("Log in")
    expect(result.conflicts).toEqual([{ kind: "workflow", recordId: "wf1", name: "Sign in", path: "name", base: "Login", ours: "Sign in", theirs: "Log in" }])
  })

  it("tells null from absent: a key one copy set to null is that copy's change", () => {
    const result = merge(flow({ variables: {} }), flow({ variables: { token: null } }), flow({ variables: {} }))

    expect(result.merged?.["variables"]).toEqual({ token: null })
  })
})

describe("an object merges key by key", () => {
  const base = flow({ variables: { user: "alice", region: "eu", tier: "free" } })

  it("keeps each copy's change to a different key", () => {
    const result = merge(base, flow({ variables: { user: "bob", region: "eu", tier: "free" } }), flow({ variables: { user: "alice", region: "us", tier: "free", extra: 1 } }))

    expect(result.merged?.["variables"]).toEqual({ user: "bob", region: "us", tier: "free", extra: 1 })
    expect(result.conflicts).toEqual([])
  })

  it("deletes a key one copy deleted and the other left alone", () => {
    const result = merge(base, flow({ variables: { user: "alice", region: "eu" } }), base)

    expect(result.merged?.["variables"]).toEqual({ user: "alice", region: "eu" })
  })

  it.each([
    ["changed differently", { user: "bob", region: "eu", tier: "free" }, { user: "carol", region: "eu", tier: "free" }, "variables.user", { base: "alice", ours: "bob", theirs: "carol" }],
    ["deleted in your copy, changed in the remote", { user: "alice", region: "eu" }, { user: "alice", region: "eu", tier: "paid" }, "variables.tier", { base: "free", theirs: "paid" }],
    ["added differently in both", { user: "alice", region: "eu", tier: "free", token: "a" }, { user: "alice", region: "eu", tier: "free", token: "b" }, "variables.token", { ours: "a", theirs: "b" }],
    ["an object in one copy, a string in the other", { user: { first: "al" }, region: "eu", tier: "free" }, { user: "bob", region: "eu", tier: "free" }, "variables.user", { base: "alice", ours: { first: "al" }, theirs: "bob" }],
  ])("%s is a conflict at that key", (_, ours, theirs, path, values) => {
    const result = merge(base, flow({ variables: ours }), flow({ variables: theirs }))

    expect(result.conflicts).toEqual([{ kind: "workflow", recordId: "wf1", name: "Login", path, ...values }])
  })

  it("escapes a dot in a key, so the path names exactly one place", () => {
    const result = merge(flow({ variables: { "api.key": "a" } }), flow({ variables: { "api.key": "b" } }), flow({ variables: { "api.key": "c" } }))

    expect(result.conflicts.map((conflict) => conflict.path)).toEqual(["variables.api\\.key"])
  })

  it("never mistakes an inherited name for a key a copy holds", () => {
    const proto = JSON.parse('{"__proto__": {"polluted": true}}') as Json
    const result = merge(flow({ variables: {} }), flow({ variables: proto }), flow({ variables: { constructor: "x" } }))

    expect(Object.keys(result.merged?.["variables"] as Json).sort()).toEqual(["__proto__", "constructor"])
    expect(({} as Json)["polluted"]).toBeUndefined()
    expect(result.conflicts).toEqual([])
  })
})

describe("a keyed array merges item by item", () => {
  it("keeps the nodes each copy added", () => {
    const base = flow({ nodes: [node("n1", 0, 0)] })
    const result = merge(base, flow({ nodes: [node("n1", 0, 0), node("n2", 200, 0)] }), flow({ nodes: [node("n1", 0, 0), node("n3", 400, 0)] }))

    expect(nodesOf(result.merged).map((item) => item["nodeId"])).toEqual(["n1", "n2", "n3"])
    expect(result.conflicts).toEqual([])
  })

  it("deletes a node one copy deleted and the other left alone", () => {
    const base = chain()
    const result = merge(base, { ...base, nodes: base.nodes.slice(0, 3), edges: base.edges.slice(0, 2) }, base)

    expect(nodeOf(result.merged, "n3")).toBeUndefined()
    expect(edgeIds(result.merged)).toEqual(["e1", "e2"])
  })

  it("a node deleted in one copy and changed in the other is a conflict on the whole node", () => {
    const base = chain()
    const result = merge(base, { ...base, nodes: base.nodes.slice(0, 3), edges: base.edges.slice(0, 2) }, moved(base, "n3", { x: 600, y: 0 }, { config: { duration: 5 } }))

    expect(result.conflicts.map(({ path, ours, theirs }) => ({ path, ours, theirs }))).toEqual([
      { path: "nodes.n3", ours: undefined, theirs: node("n3", 600, 0, { config: { duration: 5 } }) },
    ])
    expect(nodeOf(result.merged, "n3")).toEqual(node("n3", 600, 0, { config: { duration: 5 } }))
  })

  it("merges two copies' changes to different fields of one node", () => {
    const base = chain()
    const result = merge(base, moved(base, "n1", { x: 200, y: 0 }, { label: "Wait" }), moved(base, "n1", { x: 200, y: 0 }, { config: { duration: 7 } }))

    expect(nodeOf(result.merged, "n1")).toEqual(node("n1", 200, 0, { label: "Wait", config: { duration: 7 } }))
    expect(result.conflicts).toEqual([])
  })

  it("the same field of one node changed differently is a conflict at that field, named by the node's id", () => {
    const base = chain()
    const result = merge(base, moved(base, "n1", { x: 200, y: 0 }, { config: { duration: 5 } }), moved(base, "n1", { x: 200, y: 0 }, { config: { duration: 9 } }))

    expect(result.conflicts.map(({ path, base: before, ours, theirs }) => ({ path, before, ours, theirs }))).toEqual([
      { path: "nodes.n1.config.duration", before: 100, ours: 5, theirs: 9 },
    ])
  })

  it("merges edges by id, apart from the nodes", () => {
    const base = chain()
    const ours = { ...base, edges: [edge("e1", "a", "n1", { label: "go" }), base.edges[1]!, base.edges[2]!] }
    const theirs = { ...base, edges: [base.edges[0]!, base.edges[1]!, edge("e3", "n1", "n3")] }
    const result = merge(base, ours, theirs)

    expect(result.merged?.["edges"]).toEqual([edge("e1", "a", "n1", { label: "go" }), edge("e2", "n1", "n2"), edge("e3", "n1", "n3")])
  })

  it("an edge both copies drew between the same nodes is one edge; different labels on it are a conflict", () => {
    const base = chain()
    const drawn = (label: string) => ({ ...base, edges: [...base.edges, edge("reactflow__edge-n1-n3", "n1", "n3", { label })] })

    expect(merge(base, drawn("x"), drawn("x")).merged?.["edges"]).toHaveLength(4)
    expect(merge(base, drawn("x"), drawn("y")).conflicts.map((conflict) => conflict.path)).toEqual(["edges.reactflow__edge-n1-n3.label"])
  })

  it("a node both copies added under one id merges field by field", () => {
    const base = flow({ nodes: [] })
    const result = merge(base, flow({ nodes: [node("n9", 10, 10, { label: "mine" })] }), flow({ nodes: [node("n9", 10, 10, { config: { duration: 3 } })] }))

    expect(result.conflicts.map((conflict) => conflict.path)).toEqual(["nodes.n9.config.duration"])
    expect(nodeOf(result.merged, "n9")?.["label"]).toBe("mine")
  })

  it("is one value when a copy holds two items under one key: they cannot be told apart", () => {
    const base = chain()
    const result = merge(base, { ...base, nodes: [...base.nodes, node("n1", 900, 0)] }, moved(base, "n2", { x: 401, y: 0 }))

    expect(result.conflicts.map((conflict) => conflict.path)).toEqual(["nodes"])
  })

  it("merges tags as a set: each copy's additions stay, a removal goes, and nothing conflicts", () => {
    const result = merge(flow({ tags: ["smoke", "slow"] }), flow({ tags: ["smoke", "nightly"] }), flow({ tags: ["smoke", "slow", "api"] }))

    expect(result.merged?.["tags"]).toEqual(["smoke", "api", "nightly"])
    expect(result.conflicts).toEqual([])
  })

  it("merges an array the format does not key as one value: node templates, a node's headers", () => {
    const http = (headers: Json[]) => ({ nodeId: "h1", type: "http-request", position: { x: 0, y: 0 }, config: { method: "GET", url: "https://api.test", headers } })
    const base = flow({ nodes: [http([])], nodeTemplates: [] })
    const ours = flow({ nodes: [http([{ key: "A", value: "1" }])], nodeTemplates: [{ name: "Mine" }] })
    const theirs = flow({ nodes: [http([{ key: "B", value: "2" }])], nodeTemplates: [{ name: "Theirs" }] })

    expect(merge(base, ours, theirs).conflicts.map((conflict) => conflict.path)).toEqual(["nodeTemplates", "nodes.h1.config.headers"])
    expect(merge(base, ours, base).merged?.["nodeTemplates"]).toEqual([{ name: "Mine" }])
  })
})

describe("a node's position", () => {
  const base = chain()

  it("moved in your copy only: yours", () => {
    const result = merge(base, moved(base, "n1", { x: 210, y: 0 }), base)

    expect(nodeOf(result.merged, "n1")?.["position"]).toEqual({ x: 210, y: 0 })
    expect(result.notes).toEqual([])
  })

  it("moved differently in both copies: the remote copy's, settled without a conflict and noted", () => {
    const result = merge(base, moved(moved(base, "n1", { x: 210, y: 0 }), "n2", { x: 410, y: 9 }), moved(moved(base, "n1", { x: 220, y: 5 }), "n2", { x: 405, y: 0 }))

    expect(nodeOf(result.merged, "n1")?.["position"]).toEqual({ x: 220, y: 5 })
    expect(nodeOf(result.merged, "n2")?.["position"]).toEqual({ x: 405, y: 0 })
    expect(result.conflicts).toEqual([])
    expect(result.notes).toEqual([{ type: "positions", recordId: "wf1", name: "Login", nodeIds: ["n1", "n2"] }])
  })

  it("moved alike in both copies: nothing to note", () => {
    expect(merge(base, moved(base, "n1", { x: 210, y: 0 }), moved(base, "n1", { x: 210, y: 0 })).notes).toEqual([])
  })

  describe("follows its frame, because it is relative to it", () => {
    const framed = flow({ nodes: [frame("g1", 100, 100), frame("g2", 500, 100), node("n1", 300, 300)] })
    const into = (frameId: string, x: number, y: number) => moved(framed, "n1", { x, y }, { parentId: frameId })

    it("put in a frame in your copy, moved in the remote copy: your frame, and your position in it", () => {
      const result = merge(framed, into("g1", 200, 200), moved(framed, "n1", { x: 310, y: 300 }))

      expect(nodeOf(result.merged, "n1")).toMatchObject({ parentId: "g1", position: { x: 200, y: 200 } })
      expect(result.notes).toEqual([])
    })

    it("put in a frame in the remote copy, moved in yours: the remote's frame and position", () => {
      const result = merge(framed, moved(framed, "n1", { x: 310, y: 300 }), into("g1", 200, 200))

      expect(nodeOf(result.merged, "n1")).toMatchObject({ parentId: "g1", position: { x: 200, y: 200 } })
    })

    it("put in different frames: a conflict on the frame, and the position goes with whichever frame is kept", () => {
      const ours = into("g1", 200, 200)
      const theirs = into("g2", -200, 200)

      const open = merge(framed, ours, theirs)
      expect(open.conflicts.map((conflict) => conflict.path)).toEqual(["nodes.n1.parentId"])
      expect(nodeOf(open.merged, "n1")).toMatchObject({ parentId: "g2", position: { x: -200, y: 200 } })

      const settled = merge(framed, ours, theirs, [pick("nodes.n1.parentId", "ours")])
      expect(settled.conflicts).toEqual([])
      expect(nodeOf(settled.merged, "n1")).toMatchObject({ parentId: "g1", position: { x: 200, y: 200 } })
    })
  })
})

describe("a project's workflow order", () => {
  const entry = (workflowId: string, enabled = true) => ({ workflowId, enabled, continueOnFail: false })
  const order = (...entries: ReturnType<typeof entry>[]) => project("prj1", { name: "Shop", workflowOrder: entries })
  const ids = (merged: Json | undefined) => ((merged?.["workflowOrder"] ?? []) as Json[]).map((item) => item["workflowId"])
  const mergeOrder = (base: Json, ours: Json, theirs: Json) => mergeRecord("project", base, ours, theirs)
  const base = order(entry("wf_a"), entry("wf_b"), entry("wf_c"))

  it.each([
    ["only your copy reordered it: your order", order(entry("wf_c"), entry("wf_a"), entry("wf_b")), base, ["wf_c", "wf_a", "wf_b"]],
    ["only the remote copy reordered it: its order", base, order(entry("wf_b"), entry("wf_a"), entry("wf_c")), ["wf_b", "wf_a", "wf_c"]],
    ["both copies added workflows: the remote copy's, then yours", order(entry("wf_a"), entry("wf_b"), entry("wf_c"), entry("wf_d")), order(entry("wf_a"), entry("wf_b"), entry("wf_c"), entry("wf_e")), ["wf_a", "wf_b", "wf_c", "wf_e", "wf_d"]],
    ["your copy reordered it, the remote copy added one: your order, the addition after it", order(entry("wf_c"), entry("wf_b"), entry("wf_a")), order(entry("wf_a"), entry("wf_b"), entry("wf_c"), entry("wf_d")), ["wf_c", "wf_b", "wf_a", "wf_d"]],
    ["your copy reordered it, the remote copy removed one: your order, without it", order(entry("wf_c"), entry("wf_b"), entry("wf_a")), order(entry("wf_a"), entry("wf_c")), ["wf_c", "wf_a"]],
    ["your copy added one, the remote copy reordered it: the remote's order, your addition after it", order(entry("wf_a"), entry("wf_b"), entry("wf_c"), entry("wf_d")), order(entry("wf_c"), entry("wf_b"), entry("wf_a")), ["wf_c", "wf_b", "wf_a", "wf_d"]],
    ["your copy added one, the remote copy removed one: neither reordered it", order(entry("wf_a"), entry("wf_b"), entry("wf_c"), entry("wf_d")), order(entry("wf_a"), entry("wf_c")), ["wf_a", "wf_c", "wf_d"]],
  ])("%s, without a note", (_, ours, theirs, expected) => {
    const result = mergeOrder(base, ours, theirs)

    expect(ids(result.merged)).toEqual(expected)
    expect(result.conflicts).toEqual([])
    expect(result.notes).toEqual([])
  })

  it("both copies reordered it: the remote copy's order, your additions after it, noted", () => {
    const result = mergeOrder(base, order(entry("wf_c"), entry("wf_a"), entry("wf_b"), entry("wf_d")), order(entry("wf_b"), entry("wf_a"), entry("wf_c")))

    expect(ids(result.merged)).toEqual(["wf_b", "wf_a", "wf_c", "wf_d"])
    expect(result.notes).toEqual([{ type: "order", recordId: "prj1", name: "Shop" }])
  })

  it("merges each workflow's flags; the same flag changed differently is a conflict at it", () => {
    const flags = (b: boolean, c: boolean) => order(entry("wf_a"), entry("wf_b", b), entry("wf_c", c))
    const clean = mergeOrder(flags(true, true), flags(false, true), flags(true, false))
    expect(clean.merged?.["workflowOrder"]).toEqual([entry("wf_a"), entry("wf_b", false), entry("wf_c", false)])

    const both = (continueOnFail: boolean) => order(entry("wf_a"), { workflowId: "wf_b", enabled: true, continueOnFail }, entry("wf_c"))
    expect(mergeOrder(base, both(true), { ...both(false), workflowOrder: [entry("wf_a"), { ...entry("wf_b"), enabled: false }, entry("wf_c")] }).conflicts).toEqual([])
    expect(mergeOrder(base, order(entry("wf_a"), entry("wf_b", false), entry("wf_c")), order(entry("wf_a"), { ...entry("wf_b"), continueOnFail: true }, entry("wf_c"))).conflicts).toEqual([])
    const enabled = mergeOrder(order(entry("wf_a"), { ...entry("wf_b"), enabled: true }, entry("wf_c")), order(entry("wf_a"), entry("wf_b", false), entry("wf_c")), order(entry("wf_a"), { workflowId: "wf_b", enabled: true, continueOnFail: true }, entry("wf_c")))
    expect(enabled.conflicts).toEqual([])
  })

  it("an entry one copy removed and the other changed is a conflict on the entry", () => {
    const result = mergeOrder(base, order(entry("wf_a"), entry("wf_c")), order(entry("wf_a"), entry("wf_b", false), entry("wf_c")))

    expect(result.conflicts.map((conflict) => conflict.path)).toEqual(["workflowOrder.wf_b"])
  })
})

describe("what the other copy's deletion leaves pointing at nothing", () => {
  const base = chain()
  const withoutN3 = { ...base, nodes: base.nodes.slice(0, 3), edges: base.edges.slice(0, 2) }

  it("drops an edge the remote copy drew to a node your copy deleted, and notes it", () => {
    const result = merge(base, withoutN3, { ...base, edges: [...base.edges, edge("e9", "n1", "n3")] })

    expect(edgeIds(result.merged)).toEqual(["e1", "e2"])
    expect(result.notes).toEqual([{ type: "droppedEdge", recordId: "wf1", name: "Login", edgeId: "e9", end: "target", nodeId: "n3" }])
  })

  it("names the source when that is the end the other copy deleted", () => {
    const withoutN1 = { ...base, nodes: [base.nodes[0]!, base.nodes[2]!, base.nodes[3]!], edges: [base.edges[2]!] }
    const result = merge(base, { ...base, edges: [...base.edges, edge("e9", "n1", "n3")] }, withoutN1)

    expect(result.notes).toEqual([{ type: "droppedEdge", recordId: "wf1", name: "Login", edgeId: "e9", end: "source", nodeId: "n1" }])
  })

  it("leaves an edge a copy already had pointing at nothing as that copy has it", () => {
    const ours = { ...base, edges: [...base.edges, edge("e8", "n2", "n9")] }
    const result = merge(base, ours, base)

    expect(edgeIds(result.merged)).toEqual(["e1", "e2", "e3", "e8"])
    expect(result.notes).toEqual([])
  })

  it("frees a node the remote copy put in a frame your copy deleted, where it was on the canvas", () => {
    const framed = flow({ nodes: [frame("g1", 100, 100), node("n1", 20, 30, { parentId: "g1" })] })
    const ours = flow({ nodes: [node("n1", 120, 130)] })
    const theirs = flow({ nodes: [...framed.nodes, node("n5", 40, 50, { parentId: "g1" })] })
    const result = merge(framed, ours, theirs)

    expect(nodesOf(result.merged)).toEqual([node("n1", 120, 130), node("n5", 140, 150)])
    expect(result.notes).toEqual([{ type: "freedNode", recordId: "wf1", name: "Login", nodeId: "n5", frameId: "g1" }])
  })

  describe("frees a node from nested frames your copy deleted", () => {
    const nested = flow({ nodes: [frame("f0", 100, 100), { ...frame("f1", 10, 20), parentId: "f0" }] })
    const theirs = flow({ nodes: [...nested.nodes, node("n5", 1, 2, { parentId: "f1" })] })
    const freed = [{ type: "freedNode", recordId: "wf1", name: "Login", nodeId: "n5", frameId: "f1" }]

    it("into the nearest frame around them that is left, shifted by the deleted frame only", () => {
      const result = merge(nested, flow({ nodes: [frame("f0", 100, 100)] }), theirs)

      expect(nodesOf(result.merged)).toEqual([frame("f0", 100, 100), node("n5", 11, 22, { parentId: "f0" })])
      expect(result.notes).toEqual(freed)
    })

    it("out of every frame when none is left, shifted by them all", () => {
      const result = merge(nested, flow({ nodes: [] }), theirs)

      expect(nodesOf(result.merged)).toEqual([node("n5", 111, 122)])
      expect(result.notes).toEqual(freed)
    })
  })

  it("an edge one copy deleted with its node and the other relabelled is dropped, not asked about, whichever copy deleted it", () => {
    const pair = flow({ nodes: [node("n1", 0, 0), node("n2", 200, 0)], edges: [edge("e1", "n1", "n2")] })
    const deleted = { ...pair, nodes: [node("n2", 200, 0)], edges: [] }
    const relabelled = { ...pair, edges: [edge("e1", "n1", "n2", { label: "go" })] }
    const dropped = [{ type: "droppedEdge", recordId: "wf1", name: "Login", edgeId: "e1", end: "source", nodeId: "n1" }]

    const yoursDeleted = merge(pair, deleted, relabelled)
    const remoteDeleted = merge(pair, relabelled, deleted)
    for (const result of [yoursDeleted, remoteDeleted]) {
      expect(result.conflicts).toEqual([])
      expect(nodesOf(result.merged).map((item) => item["nodeId"])).toEqual(["n2"])
      expect(edgeIds(result.merged)).toEqual([])
      expect(result.notes).toEqual(dropped)
    }
    expect(remoteDeleted.merged).toEqual(yoursDeleted.merged)
  })

  it("keeps the conflict on an edge one copy deleted alone and the other relabelled: a pick can still bring it back", () => {
    const pair = flow({ nodes: [node("n1", 0, 0), node("n2", 200, 0)], edges: [edge("e1", "n1", "n2")] })
    const result = merge(pair, { ...pair, edges: [] }, { ...pair, edges: [edge("e1", "n1", "n2", { label: "go" })] })

    expect(result.conflicts.map((conflict) => conflict.path)).toEqual(["edges.e1"])
    expect(result.notes).toEqual([])
  })

  describe("asks the same about an edge to a node still in conflict, whichever copy deleted them", () => {
    const pair = flow({ nodes: [node("n1", 0, 0), node("n2", 200, 0)], edges: [edge("e1", "n1", "n2")] })
    const changed = { ...moved(pair, "n1", { x: 50, y: 0 }), edges: [edge("e1", "n1", "n2", { label: "go" })] }
    const withoutN1 = { ...pair, nodes: [node("n2", 200, 0)], edges: [] }
    const withoutBoth = { ...pair, nodes: [], edges: [] }

    it.each([
      ["your copy deleted the node and the edge, the remote moved the node and relabelled the edge", withoutN1, changed, ["edges.e1", "nodes.n1"]],
      ["the remote copy deleted the node and the edge, yours moved the node and relabelled the edge", changed, withoutN1, ["edges.e1", "nodes.n1"]],
      ["your copy deleted both nodes and the edge, the remote moved one and relabelled the edge: the other is gone for good", withoutBoth, changed, ["nodes.n1"]],
      ["the remote copy deleted both nodes and the edge, yours moved one and relabelled the edge: the other is gone for good", changed, withoutBoth, ["nodes.n1"]],
    ])("%s", (_, ours, theirs, paths) => {
      const open = merge(pair, ours, theirs)

      expect(open.conflicts.map((conflict) => conflict.path)).toEqual(paths)
      for (const side of ["ours", "theirs"] as const) {
        expect(merge(pair, ours, theirs, paths.map((path) => pick(path, side))).conflicts).toEqual([])
      }
    })
  })

  it("drops, with its conflict, an edge both copies changed once a pick deletes the node it needs", () => {
    const theirs = { ...moved(base, "n3", { x: 600, y: 0 }, { config: { duration: 1 } }), edges: [base.edges[0]!, base.edges[1]!, edge("e3", "n2", "n3", { label: "last" })] }

    expect(merge(base, withoutN3, theirs).conflicts.map((conflict) => conflict.path)).toEqual(["edges.e3", "nodes.n3"])
    const settled = merge(base, withoutN3, theirs, [pick("nodes.n3", "ours")])
    expect(settled.conflicts).toEqual([])
    expect(edgeIds(settled.merged)).toEqual(["e1", "e2"])
    expect(settled.notes).toEqual([{ type: "droppedEdge", recordId: "wf1", name: "Login", edgeId: "e3", end: "target", nodeId: "n3" }])
  })
})

describe("a whole record", () => {
  const base = chain()
  const renamed = { ...base, name: "Sign in" }

  it.each([
    ["added in your copy", undefined, base, undefined, base],
    ["added in the remote copy", undefined, undefined, base, base],
    ["added alike in both copies", undefined, base, base, base],
    ["deleted in your copy, untouched in the remote", base, undefined, base, undefined],
    ["deleted in both copies", base, undefined, undefined, undefined],
    ["changed in one copy only", base, renamed, base, renamed],
  ])("%s merges without a conflict", (_, before, ours, theirs, expected) => {
    const result = merge(before, ours, theirs)

    expect(result.merged).toEqual(expected)
    expect(result.conflicts).toEqual([])
  })

  it("deleted in one copy and changed in the other is a conflict on the whole record", () => {
    const result = merge(base, undefined, renamed)

    expect(result.conflicts).toEqual([{ kind: "workflow", recordId: "wf1", name: "Sign in", path: "", base, theirs: renamed }])
    expect(result.merged).toEqual(renamed)
    expect(merge(base, undefined, renamed, [pick("", "ours")]).merged).toBeUndefined()
    expect(merge(base, renamed, undefined, [pick("", "ours")]).merged).toEqual(renamed)
  })

  it("added differently in both copies is one conflict on the whole record, never two records mixed", () => {
    const theirs = { ...base, nodes: [base.nodes[0]!] }
    const result = merge(undefined, renamed, theirs)

    expect(result.conflicts.map(({ path, base: before }) => ({ path, before }))).toEqual([{ path: "", before: undefined }])
    expect(result.merged).toEqual(theirs)
  })

  it("whose fields merge but do not make a valid record together is a conflict on it, with why", () => {
    const delay = flow({ nodes: [{ nodeId: "n1", type: "delay", position: { x: 0, y: 0 }, config: {} }] })
    const ours = flow({ nodes: [{ nodeId: "n1", type: "merge", position: { x: 0, y: 0 }, config: {} }] })
    const theirs = flow({ nodes: [{ nodeId: "n1", type: "delay", position: { x: 0, y: 0 }, config: { duration: 5 } }] })

    const result = merge(delay, ours, theirs)
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ path: "", base: delay, ours, theirs, invalid: expect.stringContaining("nodes.0") })
    expect(result.merged).toEqual(theirs)
    expect(merge(delay, ours, theirs, [pick("", "ours")])).toEqual({ merged: ours, conflicts: [], notes: [] })
  })

  it("is nothing when no tree holds it, and refuses copies that hold different ids", () => {
    expect(merge(undefined, undefined, undefined)).toEqual({ merged: undefined, conflicts: [], notes: [] })
    expect(() => merge(base, workflow("wf2"), base)).toThrow(/hold different ids/)
  })

  it("comes out as its file holds it: the format's field order, a frame before its nodes, edges by id", () => {
    const ours = canonical(flow({ nodes: [node("b1", 0, 0)], edges: [edge("e1", "z1", "b1")] }))
    const theirs = canonical(flow({ nodes: [node("z1", 0, 0, { parentId: "g9" }), frame("g9", 0, 0)], edges: [edge("e2", "b1", "z1")] }))
    const { merged } = merge(canonical(flow()), ours, theirs)

    expect(Object.keys(merged!)).toEqual(["workflowId", "projectId", "name", "description", "selectedEnvironmentId", "tags", "variables", "nodes", "edges", "nodeTemplates"])
    expect(nodesOf(merged).map((item) => item["nodeId"])).toEqual(["b1", "g9", "z1"])
    expect(edgeIds(merged)).toEqual(["e1", "e2"])
  })
})

describe("picks", () => {
  const base = chain({ name: "Login" })
  const ours = moved({ ...base, name: "Sign in" }, "n1", { x: 200, y: 0 }, { label: "mine", config: { duration: 5 } })
  const theirs = moved({ ...base, name: "Log in" }, "n1", { x: 200, y: 0 }, { label: "theirs", config: { duration: 9 } })
  const open = merge(base, ours, theirs)

  it("start from the conflicts the merge reports", () => {
    expect(open.conflicts.map((conflict) => conflict.path)).toEqual(["name", "nodes.n1.config.duration", "nodes.n1.label"])
  })

  it("settle the conflict at their path", () => {
    const result = merge(base, ours, theirs, [pick("name", "ours"), pick("nodes.n1.config.duration", "theirs"), pick("nodes.n1.label", "ours")])

    expect(result.conflicts).toEqual([])
    expect(result.merged?.["name"]).toBe("Sign in")
    expect(nodeOf(result.merged, "n1")).toMatchObject({ label: "mine", config: { duration: 9 } })
  })

  it("settle every conflict below their path that has no pick of its own", () => {
    const result = merge(base, ours, theirs, [pick("nodes.n1", "ours"), pick("nodes.n1.label", "theirs")])

    expect(result.conflicts.map((conflict) => conflict.path)).toEqual(["name"])
    expect(nodeOf(result.merged, "n1")).toMatchObject({ label: "theirs", config: { duration: 5 } })
  })

  it("at the whole record settle all of its conflicts", () => {
    const result = merge(base, ours, theirs, [pick("", "ours")])

    expect(result.conflicts).toEqual([])
    expect(result.merged?.["name"]).toBe("Sign in")
  })

  it("never override what only one copy changed: a pick names a conflict or nothing", () => {
    const result = merge(base, { ...base, description: "mine" }, base, [pick("description", "theirs"), pick("", "theirs")])

    expect(result.merged?.["description"]).toBe("mine")
  })

  it("for another record, or replaced by a later pick for the same place, change nothing", () => {
    expect(merge(base, ours, theirs, [pick("name", "ours", "wf2")]).merged?.["name"]).toBe("Log in")
    expect(merge(base, ours, theirs, [pick("name", "theirs"), pick("name", "ours")]).merged?.["name"]).toBe("Sign in")
  })
})

describe("two copies with no common ancestor", () => {
  const mergeTwo = (ours: Json | undefined, theirs: Json | undefined, picks: GitMergePick[] = []) =>
    mergeRecord("workflow", undefined, ours, theirs, picks, true)

  it("keeps a record only one copy holds", () => {
    const only = flow({ name: "Only mine", tags: ["mine"] })

    expect(mergeTwo(only, undefined)).toEqual({ merged: only, conflicts: [], notes: [] })
    expect(mergeTwo(undefined, only)).toEqual({ merged: only, conflicts: [], notes: [] })
  })

  it("merges two identical records silently", () => {
    const same = flow({ name: "Same", tags: ["smoke"] })

    expect(mergeTwo(same, same)).toEqual({ merged: same, conflicts: [], notes: [] })
  })

  it("is a conflict on every field they differ on, with no ancestor to point at", () => {
    const result = mergeTwo(flow({ name: "Mine" }), flow({ name: "Theirs" }))

    expect(result.merged?.["name"]).toBe("Theirs")
    expect(result.conflicts).toEqual([{ kind: "workflow", recordId: "wf1", name: "Mine", path: "name", ours: "Mine", theirs: "Theirs" }])
  })

  it("keeps the keys only one copy holds and conflicts on a key both hold differently", () => {
    const result = mergeTwo(
      flow({ variables: { user: "mine", tier: "free" } }),
      flow({ variables: { region: "eu", tier: "paid" } }),
    )

    expect(result.merged?.["variables"]).toEqual({ region: "eu", tier: "paid", user: "mine" })
    expect(result.conflicts.map(({ path, base: before, ours, theirs }) => ({ path, before, ours, theirs }))).toEqual([
      { path: "variables.tier", before: undefined, ours: "free", theirs: "paid" },
    ])
  })

  it("merges a keyed array item by item: each copy's items stay, a shared one by its fields", () => {
    const result = mergeTwo(
      flow({ nodes: [node("n1", 0, 0, { label: "mine", config: { duration: 3 } }), node("n2", 200, 0)] }),
      flow({ nodes: [node("n1", 0, 0, { config: { duration: 3 } }), node("n3", 400, 0)] }),
    )

    expect(nodesOf(result.merged).map((item) => item["nodeId"])).toEqual(["n1", "n2", "n3"])
    expect(nodeOf(result.merged, "n1")).toMatchObject({ label: "mine", config: { duration: 3 } })
    expect(result.conflicts).toEqual([])
  })

  it("is a conflict on the field of an item both hold differently", () => {
    const result = mergeTwo(
      flow({ nodes: [node("n1", 0, 0, { config: { duration: 3 } })] }),
      flow({ nodes: [node("n1", 0, 0, { config: { duration: 5 } })] }),
    )

    expect(result.conflicts.map(({ path, ours, theirs }) => ({ path, ours, theirs }))).toEqual([
      { path: "nodes.n1.config.duration", ours: 3, theirs: 5 },
    ])
  })

  it("keeps every tag either copy has, since a tag is a set", () => {
    expect(mergeTwo(flow({ tags: ["smoke"] }), flow({ tags: ["api"] })).merged?.["tags"]).toEqual(["api", "smoke"])
  })

  it("settles all of a record's conflicts with a whole-record pick", () => {
    const result = mergeTwo(flow({ name: "Mine", description: "mine" }), flow({ name: "Theirs", description: "theirs" }), [
      pick("", "ours"),
    ])

    expect(result.conflicts).toEqual([])
    expect(result.merged).toMatchObject({ name: "Mine", description: "mine" })
  })
})

describe("a value of the user's own", () => {
  const own = (path: string, value: JsonValue): GitMergePick => ({ recordId: "wf1", path, value })

  it("settles the field it names, replacing either copy's value", () => {
    const result = merge(flow({ name: "Login" }), flow({ name: "Sign in" }), flow({ name: "Log in" }), [own("name", "Authenticate")])

    expect(result.conflicts).toEqual([])
    expect(result.merged?.["name"]).toBe("Authenticate")
  })

  it("settles nothing below the place it names", () => {
    const base = chain()
    const ours = moved(base, "n1", { x: 200, y: 0 }, { config: { duration: 5 } })
    const theirs = moved(base, "n1", { x: 200, y: 0 }, { config: { duration: 9 } })

    const result = merge(base, ours, theirs, [own("nodes.n1", { nodeId: "n1" })])

    expect(result.conflicts.map((conflict) => conflict.path)).toEqual(["nodes.n1.config.duration"])
  })

  it("changes nothing where the copies agree: a value names a conflict or nothing", () => {
    const result = merge(flow({ name: "Login" }), flow({ name: "Login" }), flow({ name: "Login" }), [own("name", "Authenticate")])

    expect(result.merged?.["name"]).toBe("Login")
    expect(result.conflicts).toEqual([])
  })

  it("settles a whole record one copy deleted with a record of its own", () => {
    const base = chain()
    const restored = { ...base, name: "Restored" }

    const result = merge(base, undefined, { ...base, name: "Sign in" }, [own("", restored)])

    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual(restored)
  })

  it("leaves a record in conflict when the value no file may hold, with the format's reason", () => {
    const result = merge(flow({ name: "Login" }), flow({ name: "Sign in" }), flow({ name: "Log in" }), [own("name", "")])

    expect(result.merged).toEqual(canonical(flow({ name: "Log in" })))
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ path: "", invalid: expect.stringContaining("name") })
  })

  it("refuses a whole-record value that renames the record, rather than writing it under another id's file", () => {
    const base = chain()
    const renamed = { ...base, name: "Sign in" }
    const other = { ...base, workflowId: "wf2", name: "Restored" }

    const result = merge(base, undefined, renamed, [own("", other)])

    expect(result.merged).toEqual(canonical(renamed))
    expect(result.conflicts).toHaveLength(1)
    expect(result.conflicts[0]).toMatchObject({ path: "", invalid: expect.stringContaining("it holds workflow wf2, not wf1") })
  })

  it("settles a record whose merged fields are invalid with a whole-record value of the user's own", () => {
    const delay = flow({ nodes: [{ nodeId: "n1", type: "delay", position: { x: 0, y: 0 }, config: {} }] })
    const ours = flow({ nodes: [{ nodeId: "n1", type: "merge", position: { x: 0, y: 0 }, config: {} }] })
    const theirs = flow({ nodes: [{ nodeId: "n1", type: "delay", position: { x: 0, y: 0 }, config: { duration: 5 } }] })
    const mine = flow({ nodes: [{ nodeId: "n1", type: "delay", position: { x: 0, y: 0 }, config: { duration: 7 } }] })

    const result = merge(delay, ours, theirs, [own("", mine)])

    expect(result.conflicts).toEqual([])
    expect(result.merged).toEqual(canonical(mine))
  })
})

describe("the other kinds of record", () => {
  it("a workspace merges its name and description", () => {
    const base = { workspaceId: "ws_01", name: "Acme", description: null }
    const result = mergeRecord("workspace", base, { ...base, name: "Acme QA" }, { ...base, description: "API tests" })

    expect(result.merged).toEqual({ workspaceId: "ws_01", name: "Acme QA", description: "API tests" })
  })

  it("an environment merges its variables by name, and its default flag like any field", () => {
    const base = environment("env_dev", { variables: { baseUrl: "https://dev.test", region: "eu" } })
    const result = mergeRecord(
      "environment",
      base,
      { ...base, variables: { baseUrl: "https://dev2.test", region: "eu" } },
      { ...base, isDefault: true, variables: { baseUrl: "https://dev.test", region: "eu", token: "{{secrets.TOKEN}}" } },
    )

    expect(result.merged).toEqual({ ...base, isDefault: true, variables: { baseUrl: "https://dev2.test", region: "eu", token: "{{secrets.TOKEN}}" } })
    expect(result.conflicts).toEqual([])
  })

  it("a project merges its fields like any record", () => {
    const base = project("prj1")
    const result = mergeRecord("project", base, { ...base, color: "#112233" }, { ...base, color: "#445566", name: "Billing" })

    expect(result.merged).toMatchObject({ name: "Billing", color: "#445566" })
    expect(result.conflicts.map((conflict) => [conflict.kind, conflict.path, conflict.name])).toEqual([["project", "color", "Project prj1"]])
  })
})
