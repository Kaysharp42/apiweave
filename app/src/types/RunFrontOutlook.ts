/**
 * What a branch is about to do, which is the only thing that decides whether the
 * camera keeps watching it.
 *
 * The three cases are meaningfully different and the camera treats them
 * differently: work in progress is watched, a step about to be taken is waited
 * for, and a branch that can neither work nor advance has handed the camera back.
 */
export interface RunFrontOutlook {
  /** Nodes on the front still working. Non-zero means keep watching: a request in
   * flight has not stopped, and its result is the thing worth being there for. */
  readonly running: number;
  /** A successor is ready to be shown, so the front is about to move on its own. */
  readonly advancing: boolean;
  /**
   * The nodes the front's next step is waiting on — the other inputs to a join it
   * has reached. Empty unless the front is genuinely stuck behind another branch,
   * which is the camera's cue to go and watch the branch that is holding it up.
   */
  readonly waitingFor: readonly string[];
  /** When the front last had news, so a stalled branch can be told from a busy
   * one without re-deriving it. */
  readonly lastEventAt: number;
}
