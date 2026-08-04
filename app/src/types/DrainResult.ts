import type { PacedEvent } from "./PacedEvent";

export interface DrainResult {
  /** Apply these to the canvas, in order. */
  released: PacedEvent[];
  /** When to call `drain` again, or null if the queue is empty. */
  nextAt: number | null;
  /**
   * Duration of the traversals this drain set in motion. Publish it before
   * applying `released`, so the edges animate over the same interval the
   * scheduler is about to wait.
   */
  fillMs: number;
}
