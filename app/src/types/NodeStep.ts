import type { NodeModalNodeType } from "./NodeModalNodeType";

/** A node the editor can step to from the one it shows, along one edge. */
export interface NodeStep {
  readonly nodeId: string;
  readonly label: string;
  /**
   * What the node does, in one line: a browser step's action and target, a
   * request's URL. Names repeat ("Click", "Click", "Click"), so this is what
   * tells two neighbours apart. Null when the node has nothing to show.
   */
  readonly detail: string | null;
  readonly nodeType: NodeModalNodeType;
  /** The output the edge leaves from: "pass", "fail", "ready", "complete", or null for a plain edge. */
  readonly handle: string | null;
  /** The node ran in the last run, so this is the way the run went. */
  readonly ranLastRun: boolean;
}
