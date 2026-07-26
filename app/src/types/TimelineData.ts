import type { TimelineRow } from "./TimelineRow";

/** The full positioned timeline and the span it covers. */
export interface TimelineData {
  readonly rows: readonly TimelineRow[];
  readonly totalMs: number;
  readonly startEpoch: number | null;
}
