import type { PacedEvent } from "./PacedEvent";

export interface ChoreographyState {
  /** target → sources, the only topology this needs. */
  predecessors: Map<string, string[]>;
  queue: PacedEvent[];
  /** When each node was last shown working. */
  shownWorkingAt: Map<string, number>;
  /** When each node was last shown finished — the start of its outgoing fills. */
  shownFinishedAt: Map<string, number>;
  /**
   * Tempo in force when each node was shown finished.
   *
   * Recorded rather than recomputed, because the tempo moves with the backlog
   * and the backlog shrinks as the queue drains: recomputing would hand two
   * branches off the same node two different gates, and they would leave
   * together on screen but arrive apart. The duration a traversal runs at is
   * fixed the moment it departs — which is also when CSS reads it.
   */
  fillAfter: Map<string, number>;
}
