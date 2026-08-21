export interface DetachDecisionInput {
  /** This renderer issued the delete or move that is now being reported back. */
  readonly initiatedLocally: boolean;
  /** A tab for this workflow is still open. */
  readonly tabIsOpen: boolean;
}
