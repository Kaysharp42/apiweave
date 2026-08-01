/**
 * One cell of a node's metrics row (`200 OK · 831ms · 4.2 KB`).
 *
 * The row keeps a stable shape: a metric with no value yet renders an em dash
 * rather than collapsing, so the row does not jump as fields arrive mid-run.
 */
export interface NodeMetric {
  /** Accessible name for the value. Not rendered visually — the row shows values only. */
  label: string;
  /** Formatted value. `null` renders the em dash placeholder. */
  value: string | null;
}
