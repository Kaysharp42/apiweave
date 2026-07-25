import type { Run } from "@shared/types/Run";

/** One node's positioned execution bar on the run timeline. */
export interface TimelineRow {
  readonly nodeId: string;
  readonly status: string;
  readonly startedAt: string | null;
  readonly completedAt: string | null;
  readonly duration: number;
  /** Offset from the run start in ms; null when no start timestamp (legacy run). */
  readonly offsetMs: number | null;
  /** Bar width in ms (completedAt − startedAt, else duration). */
  readonly widthMs: number;
  readonly hasTiming: boolean;
  readonly secretRefs: readonly string[];
  readonly statusCode?: number;
  readonly error?: string | null;
}

/** The full positioned timeline + the span it covers. */
export interface TimelineData {
  readonly rows: readonly TimelineRow[];
  readonly totalMs: number;
  readonly startEpoch: number | null;
}

function toEpoch(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Normalize a run's results into positioned waterfall rows. Bars are placed on
 * an absolute run timeline from `run.startedAt`; results without per-node
 * timestamps (runs recorded before this feature) degrade to duration-only bars.
 */
export function buildTimeline(run: Run): TimelineData {
  const startEpoch = toEpoch(run.startedAt);
  const rows: TimelineRow[] = [];

  for (const result of run.results ?? []) {
    const startedAt = result.startedAt ?? null;
    const completedAt = result.completedAt ?? null;
    const startEpochNode = toEpoch(startedAt);
    const endEpochNode = toEpoch(completedAt);
    const duration = result.duration ?? 0;
    const hasTiming = startEpochNode !== null;
    const widthMs =
      startEpochNode !== null && endEpochNode !== null
        ? Math.max(1, endEpochNode - startEpochNode)
        : Math.max(1, duration);
    const offsetMs =
      startEpochNode !== null && startEpoch !== null
        ? Math.max(0, startEpochNode - startEpoch)
        : null;

    const response = (result.response ?? undefined) as { statusCode?: number } | undefined;

    rows.push({
      nodeId: result.nodeId,
      status: result.status,
      startedAt,
      completedAt,
      duration,
      offsetMs,
      widthMs,
      hasTiming,
      secretRefs: result.secretRefs ?? [],
      ...(response?.statusCode !== undefined ? { statusCode: response.statusCode } : {}),
      ...(result.error ? { error: result.error } : {}),
    });
  }

  // Sort: positioned bars first by start time, then duration-only bars.
  rows.sort((a, b) => {
    if (a.offsetMs !== null && b.offsetMs !== null) return a.offsetMs - b.offsetMs;
    if (a.offsetMs !== null) return -1;
    if (b.offsetMs !== null) return 1;
    return 0;
  });

  let totalMs = run.duration ?? 0;
  for (const row of rows) {
    const end = (row.offsetMs ?? 0) + row.widthMs;
    if (end > totalMs) totalMs = end;
  }
  if (totalMs <= 0) totalMs = 1;

  return { rows, totalMs, startEpoch };
}

/** Format a millisecond duration for display: 3ms, 1.20s, 12.5s. */
export function formatTimelineDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "0ms";
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

/** Map a runner status to a StatusBadge-compatible status. */
export function timelineBadgeStatus(status: string): "success" | "error" | "warning" | "info" | "idle" {
  switch (status) {
    case "passed":
      return "success";
    case "failed":
      return "error";
    case "skipped":
      return "idle";
    case "running":
    case "pending":
      return "info";
    default:
      return "info";
  }
}