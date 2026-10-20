/**
 * Something a merge settled by itself, for the merge commit's message to
 * report. `recordId` and `name` are the record it happened in: a project for
 * `order`, a workflow for everything else.
 *
 * - `positions`: both copies moved these nodes; they stay where the remote copy put them.
 * - `order`: both copies reordered the project's workflows; the remote copy's order stands, with your own additions after it.
 * - `droppedEdge`: the edge's `end` was a node the other copy deleted, so the edge went too.
 * - `freedNode`: the node was in a frame the other copy deleted; it stays where it was, in the nearest frame around that one that is left, or in none.
 * - `leftProject`: the workflow was in a project the other copy deleted; it is in no project now.
 * - `clearedEnvironment`: the workflow selected an environment the other copy deleted; it selects none now.
 */
export type GitMergeNote =
  | { readonly type: "positions"; readonly recordId: string; readonly name: string; readonly nodeIds: readonly string[] }
  | { readonly type: "order"; readonly recordId: string; readonly name: string }
  | { readonly type: "droppedEdge"; readonly recordId: string; readonly name: string; readonly edgeId: string; readonly end: "source" | "target"; readonly nodeId: string }
  | { readonly type: "freedNode"; readonly recordId: string; readonly name: string; readonly nodeId: string; readonly frameId: string }
  | { readonly type: "leftProject"; readonly recordId: string; readonly name: string; readonly projectId: string }
  | { readonly type: "clearedEnvironment"; readonly recordId: string; readonly name: string; readonly environmentId: string }
