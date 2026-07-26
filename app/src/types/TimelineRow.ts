/** One node's positioned execution bar on the run timeline. */
export interface TimelineRow {
  readonly nodeId: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly duration: number;
  /** Offset from the run start in ms; null when no start timestamp (legacy run). */
  readonly offsetMs: number | null;
  /** Bar width in ms (completedAt - startedAt, else duration). */
  readonly widthMs: number;
  readonly hasTiming: boolean;
  readonly secretRefs: readonly string[];
  readonly statusCode?: number;
  readonly error?: string | null;
}
