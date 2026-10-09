/** What restoring a workflow revision would do to its nodes, as counts. */
export interface RevisionDiff {
  /** Nodes the revision has and the workflow no longer does. */
  readonly added: number;
  /** Nodes the workflow has and the revision does not. */
  readonly removed: number;
  /** Nodes in both whose configuration, label or position differs. */
  readonly changed: number;
}
