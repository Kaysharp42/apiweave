/**
 * One branch of a run, as the camera understands it: a chain of activity that
 * began at an entry point or a fan-out and continues until it joins another.
 *
 * Fronts exist because a camera can only look at one place. A workflow laid out
 * as three parallel rows produces events from all three at once, tens of columns
 * apart, and a camera aimed at all of them either frames the empty space between
 * them or alternates between them at the event rate — which is what the previous
 * model did. So the camera commits to one front and follows it, and the graph
 * decides where one front ends and the next begins: a fan-out starts a branch, a
 * join ends one.
 */
export interface RunFront {
  readonly id: number;
  /** Every node attributed to this front, in the order the run showed them. */
  readonly nodeIds: string[];
  /** Nodes on this front that are still working. */
  readonly running: Set<string>;
  /** When this front last had news: something lit up, or something finished. */
  lastEventAt: number;
  /**
   * The front this one was absorbed into at a join, once it has been.
   *
   * Absorbed rather than deleted, because the camera may be following this id and
   * a join is the story continuing rather than a reason to look elsewhere. The id
   * has to keep resolving to whatever the front became, so following a branch
   * through a merge costs no camera move at all.
   */
  mergedInto: number | null;
}
