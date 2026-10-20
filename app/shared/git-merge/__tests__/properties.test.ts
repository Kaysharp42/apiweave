import { describe, expect, it } from "vitest"
import type { GitMergePick } from "../../types/GitMergePick"
import type { GitMergeSide } from "../../types/GitMergeSide"
import type { JsonValue } from "../../types/JsonValue"
import { canonicalizeRecord } from "../../conflict-diff/canonicalize"
import { isPlainRecord } from "../../conflict-diff/diff"
import { mergeRecord } from "../record"
import { mergeTree } from "../tree"
import { edited, edge, node, project, sampleTree, treeOf, workflow, type Json, type Tree, type WorkflowFile } from "./trees"

/**
 * A seeded PRNG (mulberry32), so a failing iteration can be re-run exactly:
 * every failure names its iteration and seed. No dependency, and no reliance on
 * the runtime's own Math.random.
 */
function prng(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state + 0x6d2b79f5) >>> 0
    let t = state
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const BASE_SEED = 0x5eed_1e55
const ITERATIONS = 300

/** The document the format writes for `value`, so two shapes of the same record compare equal. */
function canonical(kind: "workflow" | "project", value: JsonValue): Json {
  const read = canonicalizeRecord(kind, value)
  if (!("document" in read)) throw new Error(`generated an invalid ${kind}: ${read.invalid}`)
  return read.document
}

function failure(seed: number, message: string): Error {
  return new Error(`iteration ${seed - BASE_SEED}, seed ${seed}: ${message}`)
}

/** A random value of a shape the format holds. */
function randomValue(random: () => number): JsonValue {
  const choice = Math.floor(random() * 6)
  if (choice === 0) return `v${Math.floor(random() * 100)}`
  if (choice === 1) return Math.floor(random() * 100)
  if (choice === 2) return random() < 0.5
  if (choice === 3) return null
  if (choice === 4) return [Math.floor(random() * 10), `x${Math.floor(random() * 10)}`]
  return { nested: Math.floor(random() * 10) }
}

/** A workflow of delay nodes: every field of it is one whose merge keeps the record valid. */
function randomWorkflow(random: () => number): WorkflowFile {
  const variables: Record<string, JsonValue> = {}
  for (const key of ["alpha", "beta", "gamma"].slice(0, Math.floor(random() * 4))) variables[key] = randomValue(random)
  const nodes: Json[] = [{ nodeId: "start", type: "start", position: { x: 0, y: 0 } }]
  const edges: Json[] = []
  const count = Math.floor(random() * 4)
  for (let index = 0; index < count; index += 1) nodes.push(node(`n${index}`, 100 * (index + 1), Math.floor(random() * 40)))
  for (let index = 1; index < nodes.length; index += 1) edges.push(edge(`e${index}`, (nodes[index - 1] as Json)["nodeId"] as string, (nodes[index] as Json)["nodeId"] as string))
  const tags = ["smoke", "slow", "nightly"].filter(() => random() < 0.4)
  return workflow("wf1", {
    name: ["Login", "Sign in", "Checkout"][Math.floor(random() * 3)]!,
    description: random() < 0.5 ? "" : `About ${Math.floor(random() * 10)}`,
    tags,
    variables,
    nodes,
    edges,
  })
}

type WorkflowEdit = (random: () => number, draft: WorkflowFile) => void

/** One random edit of a workflow, of a kind that keeps it a valid record. */
function randomEdit(random: () => number, source: WorkflowFile): WorkflowFile {
  const draft = structuredClone(source) as WorkflowFile
  const edits = 1 + Math.floor(random() * 3)
  for (let index = 0; index < edits; index += 1) {
    WORKFLOW_EDITS[Math.floor(random() * WORKFLOW_EDITS.length)]!(random, draft)
  }
  return draft
}

/** Each edit keeps the record valid on its own, and any three of them in sequence. */
const WORKFLOW_EDITS: readonly WorkflowEdit[] = [
  renameWorkflow,
  rewordWorkflow,
  setVariable,
  deleteVariable,
  moveNode,
  addNode,
  removeNode,
  addEdge,
  retag,
]

function renameWorkflow(random: () => number, draft: WorkflowFile): void {
  draft.name = `Name ${Math.floor(random() * 4)}`
}

function rewordWorkflow(random: () => number, draft: WorkflowFile): void {
  draft.description = `About ${Math.floor(random() * 10)}`
}

function setVariable(random: () => number, draft: WorkflowFile): void {
  draft.variables[`v${Math.floor(random() * 4)}`] = randomValue(random)
}

function deleteVariable(random: () => number, draft: WorkflowFile): void {
  delete draft.variables[`v${Math.floor(random() * 4)}`]
}

function moveNode(random: () => number, draft: WorkflowFile): void {
  const nodes = workflowNodes(draft)
  if (nodes.length === 0) return
  nodes[Math.floor(random() * nodes.length)]!["position"] = { x: Math.floor(random() * 800), y: Math.floor(random() * 600) }
}

function addNode(random: () => number, draft: WorkflowFile): void {
  const nodes = workflowNodes(draft)
  const nodeId = `n${Math.floor(random() * 20)}`
  if (nodes.some((item) => item["nodeId"] === nodeId)) return
  nodes.push(node(nodeId, Math.floor(random() * 800), Math.floor(random() * 600)))
}

function removeNode(random: () => number, draft: WorkflowFile): void {
  const nodes = workflowNodes(draft)
  const edges = workflowEdges(draft)
  if (nodes.length <= 1) return
  const removed = nodes.splice(1 + Math.floor(random() * (nodes.length - 1)), 1)[0]!
  for (let index = edges.length - 1; index >= 0; index -= 1) {
    const item = edges[index]!
    if (item["source"] === removed["nodeId"] || item["target"] === removed["nodeId"]) edges.splice(index, 1)
  }
}

function addEdge(random: () => number, draft: WorkflowFile): void {
  const nodes = workflowNodes(draft)
  const edges = workflowEdges(draft)
  if (nodes.length <= 1) return
  const sourceId = nodes[Math.floor(random() * nodes.length)]!["nodeId"] as string
  const targetId = nodes[Math.floor(random() * nodes.length)]!["nodeId"] as string
  const edgeId = `e${Math.floor(random() * 20)}`
  if (!edges.some((item) => item["edgeId"] === edgeId)) edges.push(edge(edgeId, sourceId, targetId))
}

function retag(random: () => number, draft: WorkflowFile): void {
  draft.tags = draft.tags.filter(() => random() < 0.6)
  if (random() < 0.5) draft.tags.push(`tag${Math.floor(random() * 3)}`)
}

function workflowNodes(draft: WorkflowFile): Json[] {
  return draft.nodes as Json[]
}

function workflowEdges(draft: WorkflowFile): Json[] {
  return draft.edges as Json[]
}

/** Every id a record holds: nodes, edges, tags and variables in a workflow, the entries of a project's order. */
function idsOf(kind: "workflow" | "project", value: Json | undefined): string[] {
  if (value === undefined) return []
  return kind === "workflow" ? workflowIds(value) : projectIds(value)
}

function workflowIds(value: Json): string[] {
  return [
    ...collectionIds(value["nodes"]),
    ...collectionIds(value["edges"]),
    ...tagIds(value["tags"]),
    ...Object.keys(recordOrEmpty(value["variables"])).map((key) => `variable:${key}`),
  ]
}

function collectionIds(value: JsonValue | undefined): string[] {
  return recordsOf(value).map((item) => String(item["nodeId"] ?? item["edgeId"]))
}

function tagIds(value: JsonValue | undefined): string[] {
  return Array.isArray(value) ? value.map((tag) => `tag:${String(tag)}`) : []
}

function projectIds(value: Json): string[] {
  return recordsOf(value["workflowOrder"]).map((item) => String(item["workflowId"]))
}

function recordsOf(value: JsonValue | undefined): Json[] {
  return Array.isArray(value) ? value.filter(isPlainRecord) : []
}

function recordOrEmpty(value: JsonValue | undefined): Json {
  return isPlainRecord(value) ? value : {}
}

function picksFor(conflicts: readonly { path: string }[], side: GitMergeSide): GitMergePick[] {
  return conflicts.map((conflict) => ({ recordId: "wf1", path: conflict.path, side }))
}

describe("mergeRecord properties", () => {
  it("is identity when one side made no change: merge(b, x, b) = x and merge(b, b, y) = y", () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const seed = BASE_SEED + iteration
      const random = prng(seed)
      const base = randomWorkflow(random)
      const mine = randomEdit(random, base)
      const theirs = randomEdit(random, base)
      const b = canonical("workflow", base)
      const x = canonical("workflow", mine)
      const y = canonical("workflow", theirs)

      const left = mergeRecord("workflow", b, x, b)
      const right = mergeRecord("workflow", b, b, y)
      if (JSON.stringify(left.merged) !== JSON.stringify(x)) throw failure(seed, "merge(b, x, b) did not return x")
      if (JSON.stringify(right.merged) !== JSON.stringify(y)) throw failure(seed, "merge(b, b, y) did not return y")
      expect(left.conflicts, `seed ${seed}`).toEqual([])
      expect(right.conflicts, `seed ${seed}`).toEqual([])
    }
  })

  it("is idempotent when both sides made the same change: merge(b, x, x) = x", () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const seed = BASE_SEED + iteration
      const random = prng(seed)
      const base = randomWorkflow(random)
      const changed = canonical("workflow", randomEdit(random, base))

      const result = mergeRecord("workflow", canonical("workflow", base), changed, changed)
      if (JSON.stringify(result.merged) !== JSON.stringify(changed)) throw failure(seed, "merge(b, x, x) did not return x")
      expect(result.conflicts, `seed ${seed}`).toEqual([])
      expect(result.notes, `seed ${seed}`).toEqual([])
    }
  })

  it("reports the same conflict paths whichever side is yours, with the sides' values mirrored", () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const seed = BASE_SEED + iteration
      const random = prng(seed)
      const base = randomWorkflow(random)
      const ours = canonical("workflow", randomEdit(random, base))
      const theirs = canonical("workflow", randomEdit(random, base))
      const b = canonical("workflow", base)

      const straight = mergeRecord("workflow", b, ours, theirs)
      const swapped = mergeRecord("workflow", b, theirs, ours)
      const shape = (conflict: (typeof straight.conflicts)[number], side: GitMergeSide) =>
        [conflict.path, conflict.base, side === "ours" ? conflict.ours : conflict.theirs, side === "ours" ? conflict.theirs : conflict.ours]
      const straightPaths = straight.conflicts.map((conflict) => shape(conflict, "theirs"))
      const swappedPaths = swapped.conflicts.map((conflict) => shape(conflict, "ours"))
      if (JSON.stringify(straightPaths) !== JSON.stringify(swappedPaths)) throw failure(seed, "conflicts are not symmetric under a side swap")
    }
  })

  it("leaves no conflict once every reported conflict has a pick", () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const seed = BASE_SEED + iteration
      const random = prng(seed)
      const base = randomWorkflow(random)
      const ours = canonical("workflow", randomEdit(random, base))
      const theirs = canonical("workflow", randomEdit(random, base))
      const b = canonical("workflow", base)
      const open = mergeRecord("workflow", b, ours, theirs)

      for (const side of ["ours", "theirs"] as const) {
        const settled = mergeRecord("workflow", b, ours, theirs, picksFor(open.conflicts, side))
        if (settled.conflicts.length > 0) throw failure(seed, `conflicts remain after picking ${side} at ${settled.conflicts.map((conflict) => conflict.path).join(", ")}`)
      }
    }
  })

  it("never invents an id: every node, edge, tag, variable and order id came from one of the three trees", () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const seed = BASE_SEED + iteration
      const random = prng(seed)
      const base = randomWorkflow(random)
      const ours = canonical("workflow", randomEdit(random, base))
      const theirs = canonical("workflow", randomEdit(random, base))
      const b = canonical("workflow", base)
      const open = mergeRecord("workflow", b, ours, theirs)
      const settled = mergeRecord("workflow", b, ours, theirs, picksFor(open.conflicts, "theirs"))
      const known = new Set([...idsOf("workflow", b), ...idsOf("workflow", ours), ...idsOf("workflow", theirs)])

      for (const merged of [open.merged, settled.merged]) {
        for (const id of idsOf("workflow", merged)) if (!known.has(id)) throw failure(seed, `merged tree invented id ${id}`)
      }
    }
  })

  it("applies a project's order picks at a workflow entry and at the whole record", () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const seed = BASE_SEED + iteration
      const random = prng(seed)
      const entry = (workflowId: string) => ({ workflowId, enabled: random() < 0.5, continueOnFail: random() < 0.5 })
      const base = canonical("project", project("prj1", { workflowOrder: [entry("wf_a"), entry("wf_b"), entry("wf_c")] }))
      const ours = canonical("project", project("prj1", { workflowOrder: [entry("wf_a"), entry("wf_c"), entry("wf_b"), entry("wf_d")] }))
      const theirs = canonical("project", project("prj1", { workflowOrder: [entry("wf_c"), entry("wf_b"), entry("wf_a")] }))
      const open = mergeRecord("project", base, ours, theirs)

      const settled = mergeRecord("project", base, ours, theirs, picksFor(open.conflicts, "ours").map((pick) => ({ ...pick, recordId: "prj1" })))
      if (settled.conflicts.length > 0) throw failure(seed, "project conflicts remain after picks")

      const whole = mergeRecord("project", base, ours, theirs, [{ recordId: "prj1", path: "", side: random() < 0.5 ? "ours" : "theirs" }])
      if (whole.conflicts.length > 0) throw failure(seed, "whole-record project pick left conflicts")
    }
  })
})

describe("mergeTree properties", () => {
  const base = sampleTree()
  const baseFiles = treeOf(base)

  it("is identity when one side made no change: merge(b, x, b) = x and merge(b, b, y) = y", () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const seed = BASE_SEED + iteration
      const random = prng(seed)
      const ours = edited(base, (draft) => randomTreeEdit(random, draft))
      const theirs = edited(base, (draft) => randomTreeEdit(random, draft))
      const oursFiles = treeOf(ours)
      const theirsFiles = treeOf(theirs)

      const left = mergeTree(baseFiles, oursFiles, baseFiles)
      const right = mergeTree(baseFiles, baseFiles, theirsFiles)
      expect([...left.files], `seed ${seed}`).toEqual([...oursFiles])
      expect([...right.files], `seed ${seed}`).toEqual([...theirsFiles])
      expect(left.conflicts, `seed ${seed}`).toEqual([])
      expect(right.conflicts, `seed ${seed}`).toEqual([])
    }
  })

  it("never invents a record id, and settles every conflict it reports when picked", () => {
    for (let iteration = 0; iteration < ITERATIONS; iteration += 1) {
      const seed = BASE_SEED + iteration
      const random = prng(seed)
      const ours = treeOf(edited(base, (draft) => randomTreeEdit(random, draft)))
      const theirs = treeOf(edited(base, (draft) => randomTreeEdit(random, draft)))
      const open = mergeTree(baseFiles, ours, theirs)
      const recordId = (path: string): string | undefined => /^(?:projects|workflows|environments)\/[a-z0-9-]+--(.+)\.json$/.exec(path)?.[1]
      const known = new Set([...baseFiles.keys(), ...ours.keys(), ...theirs.keys()].flatMap((path) => recordId(path) ?? []))

      for (const path of open.files.keys()) {
        const id = recordId(path)
        if (id !== undefined && !known.has(id)) throw failure(seed, `merged tree invented record ${id}`)
      }
      const settled = mergeTree(baseFiles, ours, theirs, open.conflicts.map((conflict) => ({ recordId: conflict.recordId, path: conflict.path, side: "theirs" as const })))
      if (settled.conflicts.length > 0) throw failure(seed, `conflicts remain: ${settled.conflicts.map((conflict) => `${conflict.recordId} ${conflict.path}`).join(", ")}`)
    }
  })
})

type TreeEdit = (random: () => number, draft: Tree) => void

/** One random edit of a whole tree, keeping every record valid. */
function randomTreeEdit(random: () => number, draft: Tree): void {
  TREE_EDITS[Math.floor(random() * TREE_EDITS.length)]!(random, draft)
}

const TREE_EDITS: readonly TreeEdit[] = [
  renameWorkspace,
  rewordWorkspace,
  renameTreeWorkflow,
  addWorkflow,
  removeWorkflow,
  recolorProject,
  setEnvironmentVariable,
  tagWorkflow,
]

function renameWorkspace(random: () => number, draft: Tree): void {
  draft.workspace.name = `Acme ${Math.floor(random() * 4)}`
}

function rewordWorkspace(random: () => number, draft: Tree): void {
  draft.workspace.description = random() < 0.5 ? null : `About ${Math.floor(random() * 10)}`
}

function renameTreeWorkflow(random: () => number, draft: Tree): void {
  const flow = pickOne(random, draft.workflows)
  if (flow !== undefined) flow.name = `Flow ${Math.floor(random() * 5)}`
}

function addWorkflow(random: () => number, draft: Tree): void {
  draft.workflows.push(workflow(`wf_new${Math.floor(random() * 3)}`, { name: "New", nodes: [node("n1", Math.floor(random() * 300), 0)] }))
}

function removeWorkflow(random: () => number, draft: Tree): void {
  if (draft.workflows.length > 1) draft.workflows.splice(Math.floor(random() * draft.workflows.length), 1)
}

function recolorProject(random: () => number, draft: Tree): void {
  const first = draft.projects[0]
  if (first !== undefined) first.color = `#${Math.floor(random() * 0xffffff).toString(16).padStart(6, "0")}`
}

function setEnvironmentVariable(random: () => number, draft: Tree): void {
  const environment = pickOne(random, draft.environments)
  if (environment !== undefined) environment.variables[`v${Math.floor(random() * 3)}`] = randomValue(random)
}

function tagWorkflow(random: () => number, draft: Tree): void {
  const flow = draft.workflows[0]
  if (flow !== undefined) flow.tags = [...new Set([...flow.tags, `tag${Math.floor(random() * 3)}`])]
}

function pickOne<T>(random: () => number, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[Math.floor(random() * items.length)]
}
