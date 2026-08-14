import type { RunFront } from "./RunFront";
import type { SeenRunNode } from "./SeenRunNode";

/**
 * Which branch of the run each node belongs to, which branch the camera is
 * following, and how long it has been following it.
 *
 * Mutable and rebuilt per run, like `ChoreographyState` — the tracker is a state
 * machine driven by the same paced event stream the canvas repaints from, and
 * the camera reads it once per frame.
 */
export interface RunFrontsState {
  /** source → targets, for asking what a branch could do next. */
  readonly successors: Map<string, string[]>;
  /** target → sources, for recognising a join and for finding what one waits on. */
  readonly predecessors: Map<string, string[]>;
  readonly nodes: Map<string, SeenRunNode>;
  readonly fronts: Map<number, RunFront>;
  /**
   * Nodes that have already handed their front on to a child.
   *
   * This is what turns a fan-out into a branch: the first child of a node
   * continues its front, and any later child has to open one, because from there
   * on they are genuinely two things happening at once.
   */
  readonly extended: Set<string>;
  nextFrontId: number;
  seq: number;
  /** The front the camera is following, unresolved — resolve before use. */
  subject: number | null;
  /** When the camera committed to `subject`, so a handoff can be rate-limited
   * without the camera needing a clock of its own. */
  subjectSince: number;
}
