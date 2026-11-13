import type { IterationRow } from "@shared/iteration-data/iterationData";

/** The settings of a load run, as the Load dialog collects them. */
export interface LoadRunRequest {
  /** Rows of a data file, reused in order; absent runs with no data. */
  readonly rows?: readonly IterationRow[];
  readonly iterations: number;
  readonly concurrency: number;
  readonly durationMs?: number;
  readonly rampUpMs?: number;
  /** Expressions such as `p95<500` or `errors<1%`. */
  readonly thresholds: readonly string[];
}
