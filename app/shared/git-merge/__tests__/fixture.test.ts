import { describe, expect, it } from "vitest"
import type { JsonValue } from "../../types/JsonValue"
import { canonicalizeRecord } from "../../conflict-diff/canonicalize"
import { mergeRecord } from "../record"
import { edge, workflow, type Json, type WorkflowFile } from "./trees"
import fixtureJson from "./__fixtures__/long-state-machine.json"

/**
 * The 130-node workflow from the run-camera probe: topology only — node ids,
 * types, positions and neutral configs, and edges. No names, URLs, headers,
 * bodies, variables, environments or secrets from a local database, so it can
 * live in the repository. `fixture.test.ts` pins that.
 */
const fixture = fixtureJson as unknown as { nodes: Json[]; edges: Json[] }

function probe(fields: Partial<WorkflowFile> = {}): WorkflowFile {
  return workflow("wf_probe", { name: "Long state machine", nodes: fixture.nodes, edges: fixture.edges, ...fields })
}

function canonical(value: WorkflowFile): Json {
  const read = canonicalizeRecord("workflow", value as JsonValue)
  if (!("document" in read)) throw new Error(`the fixture is not a valid workflow: ${read.invalid}`)
  return read.document
}

const base = canonical(probe())

function nodeAt(document: Json, nodeId: string): Json {
  const found = (document["nodes"] as Json[]).find((item) => item["nodeId"] === nodeId)
  if (found === undefined) throw new Error(`no node ${nodeId}`)
  return found
}

/** `base` with the given nodes' configs changed, as one device would have saved it. */
function editConfig(nodeIds: readonly string[], change: (node: Json) => void): WorkflowFile {
  const edited = structuredClone(base) as Json
  for (const nodeId of nodeIds) {
    const item = nodeAt(edited, nodeId)
    item["config"] = { ...(item["config"] as Json) }
    change(item)
  }
  return edited as WorkflowFile
}

describe("the 130-node probe workflow", () => {
  it("is topology only", () => {
    expect(Object.keys(fixture).sort()).toEqual(["edges", "nodes"])
    expect(fixture.nodes).toHaveLength(130)
    expect(fixture.edges).toHaveLength(133)
    for (const node of fixture.nodes) {
      expect(Object.keys(node).every((key) => ["nodeId", "type", "position", "config", "parentId"].includes(key))).toBe(true)
      if (node.config !== undefined) expect(Object.keys(node.config as Json).every((key) => ["duration", "mergeStrategy"].includes(key))).toBe(true)
    }
    for (const edge of fixture.edges) expect(Object.keys(edge).sort()).toEqual(["edgeId", "source", "target"])
    expect(JSON.stringify(fixture)).not.toMatch(/https?:|[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[a-z]{2,}/)
  })

  it("merges disjoint edits on far-apart nodes cleanly, keeping both", () => {
    const ours = editConfig(["n001"], (node) => {
      node["config"] = { ...(node["config"] as Json), duration: 1 }
    })
    const theirs = editConfig(["n126"], (node) => {
      node["config"] = { ...(node["config"] as Json), duration: 2 }
    })

    const result = mergeRecord("workflow", base, canonical(ours), canonical(theirs))

    expect(result.conflicts).toEqual([])
    expect((nodeAt(result.merged!, "n001")["config"] as Json)["duration"]).toBe(1)
    expect((nodeAt(result.merged!, "n126")["config"] as Json)["duration"]).toBe(2)
    expect(result.notes).toEqual([])
  })

  it("takes the remote copy's positions when both moved the same row, and notes it", () => {
    const row = ["n010", "n011", "n012", "n013", "n014"]
    const moved = (dy: number): WorkflowFile => {
      const edited = structuredClone(base) as Json
      for (const nodeId of row) {
        const item = nodeAt(edited, nodeId)
        item["position"] = { x: (item["position"] as Json)["x"] as number, y: ((item["position"] as Json)["y"] as number) + dy }
      }
      return edited as WorkflowFile
    }

    const result = mergeRecord("workflow", base, canonical(moved(10)), canonical(moved(40)))

    expect(result.conflicts).toEqual([])
    expect(nodeAt(result.merged!, "n010")["position"]).toEqual(nodeAt(canonical(moved(40)), "n010")["position"])
    expect(result.notes).toEqual([{ type: "positions", recordId: "wf_probe", name: "Long state machine", nodeIds: row }])
  })

  it("drops the dangling edges a node's deletion leaves, with a structured note", () => {
    const deleted = structuredClone(base) as Json
    const doomed = new Set(["n005"])
    deleted["nodes"] = (deleted["nodes"] as Json[]).filter((node) => !doomed.has(node["nodeId"] as string))
    const incident = (deleted["edges"] as Json[]).filter((item) => doomed.has(item["source"] as string) || doomed.has(item["target"] as string)).map((item) => item["edgeId"] as string)
    deleted["edges"] = (deleted["edges"] as Json[]).filter((item) => !incident.includes(item["edgeId"] as string))
    const theirs = structuredClone(base) as Json
    theirs["edges"] = [...(theirs["edges"] as Json[]), edge("e999", "n004", "n005")]

    const result = mergeRecord("workflow", base, deleted, theirs)

    expect(result.conflicts).toEqual([])
    expect((result.merged!["nodes"] as Json[]).some((node) => node["nodeId"] === "n005")).toBe(false)
    expect((result.merged!["edges"] as Json[]).some((item) => item["source"] === "n005" || item["target"] === "n005")).toBe(false)
    expect(result.notes).toEqual([{ type: "droppedEdge", recordId: "wf_probe", name: "Long state machine", edgeId: "e999", end: "target", nodeId: "n005" }])
  })

  it("merges well under 100 ms and deterministically", () => {
    const ours = editConfig(["n001"], (node) => {
      node["config"] = { ...(node["config"] as Json), duration: 4 }
    })
    const theirs = editConfig(["n126"], (node) => {
      node["config"] = { ...(node["config"] as Json), duration: 3 }
    })

    mergeRecord("workflow", base, canonical(ours), canonical(theirs))
    const start = performance.now()
    const first = mergeRecord("workflow", base, canonical(ours), canonical(theirs))
    const elapsed = performance.now() - start
    const second = mergeRecord("workflow", base, canonical(ours), canonical(theirs))

    expect(elapsed).toBeLessThan(100)
    expect(JSON.stringify(first.merged)).toBe(JSON.stringify(second.merged))
    expect(first.conflicts).toEqual(second.conflicts)
  })
})
