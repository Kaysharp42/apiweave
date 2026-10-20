import { describe, expect, it } from "vitest"
import type { GitMergeNote } from "../../types/GitMergeNote"
import { describeMergeNote } from "../notes"

describe("describeMergeNote", () => {
  it("names the workflows whose position both copies moved, singular and plural", () => {
    expect(describeMergeNote(note({ type: "positions", nodeIds: ["n1"] }))).toBe(
      'workflow "Login": kept the remote copy\'s position for 1 node both copies moved (n1)',
    )
    expect(describeMergeNote(note({ type: "positions", nodeIds: ["n1", "n2"] }))).toBe(
      'workflow "Login": kept the remote copy\'s position for 2 nodes both copies moved (n1, n2)',
    )
  })

  it("reports an order both copies changed, and an edge whose endpoint went", () => {
    expect(describeMergeNote(note({ type: "order" }))).toBe(
      'project "Login": kept the remote copy\'s workflow order, with your new workflows after it',
    )
    expect(describeMergeNote(note({ type: "droppedEdge", edgeId: "e7", end: "target", nodeId: "n2" }))).toBe(
      'workflow "Login": dropped edge e7, whose target n2 was deleted',
    )
    expect(describeMergeNote(note({ type: "droppedEdge", edgeId: "e7", end: "source", nodeId: "n2" }))).toBe(
      'workflow "Login": dropped edge e7, whose source n2 was deleted',
    )
  })

  it("reports a node left outside a deleted frame, and a record left pointing at a deleted one", () => {
    expect(describeMergeNote(note({ type: "freedNode", nodeId: "n1", frameId: "f1" }))).toBe(
      'workflow "Login": node n1 left frame f1, which was deleted',
    )
    expect(describeMergeNote(note({ type: "leftProject", projectId: "prj1" }))).toBe(
      'workflow "Login" left project prj1, which was deleted',
    )
    expect(describeMergeNote(note({ type: "clearedEnvironment", environmentId: "env1" }))).toBe(
      'workflow "Login" no longer selects environment env1, which was deleted',
    )
  })
})

/** A note about the workflow or project named "Login": the message is the only thing under test. */
function note(fields: Partial<GitMergeNote> & Pick<GitMergeNote, "type">): GitMergeNote {
  return { recordId: "wf1", name: "Login", ...fields } as GitMergeNote
}
