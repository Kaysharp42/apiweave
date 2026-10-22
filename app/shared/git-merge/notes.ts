import type { GitMergeNote } from "../types/GitMergeNote"

/** A note as one line of a merge commit's message. */
export function describeMergeNote(note: GitMergeNote): string {
  const workflow = `workflow "${note.name}"`
  switch (note.type) {
    case "positions":
      return `${workflow}: kept the remote copy's position for ${plural(note.nodeIds.length, "node")} both copies moved (${note.nodeIds.join(", ")})`
    case "order":
      return `project "${note.name}": kept the remote copy's workflow order, with your new workflows after it`
    case "droppedEdge":
      return `${workflow}: dropped edge ${note.edgeId}, whose ${note.end} ${note.nodeId} was deleted`
    case "freedNode":
      return `${workflow}: node ${note.nodeId} left frame ${note.frameId}, which was deleted`
    case "leftProject":
      return `${workflow} left project ${note.projectId}, which was deleted`
    case "clearedEnvironment":
      return `${workflow} no longer selects environment ${note.environmentId}, which was deleted`
  }
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`
}
