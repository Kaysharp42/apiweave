import type { NodeMetric } from "../types/NodeMetric";

/**
 * Formatting helpers for the node run strip's metrics row.
 *
 * The row keeps a stable shape on purpose: a field with no value yet renders
 * `METRIC_PLACEHOLDER` rather than collapsing. The reference animation this
 * design draws from violated that — one card showed a bare `171ms` while its
 * siblings showed two fields, and the row visibly jumped between frames.
 */

/** Rendered in place of a metric that has no value yet. */
export const METRIC_PLACEHOLDER = "—";

/** Separator between metric cells. */
export const METRIC_SEPARATOR = "·";

/**
 * `831ms` below a second, `2.6s` at or above it.
 *
 * Sub-millisecond durations round to `0ms` rather than `0.0ms`; a duration is a
 * measurement, and three decimal places of noise is not information.
 */
export function formatDuration(ms: number | null | undefined): string | null {
  if (ms === null || ms === undefined) return null;
  if (!Number.isFinite(ms) || ms < 0) return null;
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * `512 B`, `4.2 KB`, `1.8 MB` — one decimal place above a kilobyte.
 *
 * Uses 1024-based units, matching how the rest of the app reports payload
 * sizes.
 */
export function formatSize(bytes: number | null | undefined): string | null {
  if (bytes === null || bytes === undefined) return null;
  if (!Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes < 1024) return `${Math.round(bytes)} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(1)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}

/**
 * `2 passed`, `1/3 passed` — the assertion pass vocabulary.
 *
 * Returns null when there is nothing to count, so the caller can fall back to
 * the placeholder rather than rendering `0 of 0`.
 */
export function formatPassRatio(
  passed: number | null | undefined,
  total: number | null | undefined,
): string | null {
  if (passed === null || passed === undefined) return null;
  if (!Number.isFinite(passed) || passed < 0) return null;
  if (total === null || total === undefined || !Number.isFinite(total)) {
    return `${passed} passed`;
  }
  if (total <= 0) return null;
  if (passed === total) return `${passed} passed`;
  return `${passed}/${total} passed`;
}

/**
 * The rendered text of a metric cell — its value, or the placeholder.
 *
 * Kept as a function rather than inlined in the component so the placeholder
 * rule has one definition and one test.
 */
export function metricText(metric: NodeMetric): string {
  const value = metric.value;
  if (value === null) return METRIC_PLACEHOLDER;
  const trimmed = value.trim();
  return trimmed.length === 0 ? METRIC_PLACEHOLDER : trimmed;
}
