import { useEffect, useState } from "react";
import { Activity, Lock } from "lucide-react";
import type { Run as SharedRun } from "@shared/types/Run";
import type { ResolvedSecretInfo } from "@shared/types/ResolvedSecretInfo";
import { apiweave, IpcError } from "../../utils/apiweaveClient";
import {
  buildTimeline,
  formatTimelineDuration,
  timelineBadgeStatus,
} from "../../utils/runTimeline";
import { Modal } from "../molecules/Modal";
import { StatusBadge } from "../molecules/StatusBadge";
import { EmptyState } from "../molecules/EmptyState";
import { Badge } from "../atoms/Badge";
import { Spinner } from "../atoms/Spinner";
import { SecretResolutionIndicator } from "../molecules/SecretResolutionIndicator";
import type { RunTimelineProps, TimelineRow } from "../../types";

function rowColor(status: string): string {
  switch (status) {
    case "passed":
      return "bg-status-success/70 dark:bg-[var(--aw-status-success)]/70";
    case "failed":
      return "bg-status-error/70 dark:bg-[var(--aw-status-error)]/70";
    case "skipped":
      return "bg-text-muted/40 dark:bg-text-muted-dark/40";
    default:
      return "bg-status-info/60 dark:bg-[var(--aw-status-info)]/60";
  }
}

export function RunTimelinePanel({ isOpen, onClose, workspaceId, runId }: RunTimelineProps) {
  const [run, setRun] = useState<SharedRun | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !workspaceId || !runId) {
      setRun(null);
      setError(null);
      setSelectedNodeId(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    apiweave
      .runs.get(workspaceId, runId)
      .then((r) => {
        if (!cancelled) setRun(r as unknown as SharedRun);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof IpcError ? e.message : "Failed to load run");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, workspaceId, runId]);

  const timeline = run ? buildTimeline(run) : null;
  const resolvedSecrets = (run?.resolvedSecrets ?? []) as readonly ResolvedSecretInfo[];
  const selected = timeline?.rows.find((r) => r.nodeId === selectedNodeId) ?? null;

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Run timeline"
      size="xl"
      headerExtra={
        run ? (
          <div className="flex items-center gap-2">
            <StatusBadge status={timelineBadgeStatus(run.status)} size="xs" label={run.status} />
            <Badge variant="secondary" size="sm">
              {formatTimelineDuration(run.duration ?? 0)}
            </Badge>
            {resolvedSecrets.length > 0 && (
              <Badge variant="primary" size="sm" title={`${resolvedSecrets.length} secret reference(s)`}>
                <Lock className="w-3 h-3" />
                {resolvedSecrets.length}
              </Badge>
            )}
          </div>
        ) : undefined
      }
    >
      <div className="p-5 space-y-4">
        {loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Spinner size="lg" />
            <span className="text-sm text-text-secondary dark:text-text-secondary-dark">Loading run…</span>
          </div>
        ) : error ? (
          <EmptyState title="Could not load run" description={error} />
        ) : !timeline || timeline.rows.length === 0 ? (
          <EmptyState
            icon={<Activity className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
            title="No execution data"
            description="Run the workflow to populate the timeline."
          />
        ) : (
          <>
            {/* Secrets summary (5.3) */}
            {resolvedSecrets.length > 0 && (
              <div className="rounded border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3 space-y-2">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-text-secondary dark:text-text-secondary-dark">
                  <Lock className="w-3.5 h-3.5" />
                  Resolved secrets (values masked)
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {resolvedSecrets.map((s) => (
                    <Badge
                      key={s.name}
                      variant={s.resolved ? "success" : "error"}
                      size="sm"
                      title={s.resolved ? `Resolved from ${s.scopeType ?? "unknown"} scope` : "Not found in any scope"}
                    >
                      <Lock className="w-3 h-3" />
                      {s.name}
                      <span className="opacity-70">
                        {s.resolved ? ` · ${s.scopeType}` : " · missing"}
                      </span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {/* Waterfall */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-[10px] text-text-muted dark:text-text-muted-dark font-mono px-1">
                <span>start</span>
                <span>{formatTimelineDuration(timeline.totalMs)}</span>
              </div>
              {timeline.rows.map((row: TimelineRow) => {
                const leftPct = row.offsetMs !== null ? (row.offsetMs / timeline.totalMs) * 100 : 0;
                const widthPct = Math.max(2, (row.widthMs / timeline.totalMs) * 100);
                const selectedRow = row.nodeId === selectedNodeId;
                return (
                  <button
                    type="button"
                    key={row.nodeId}
                    onClick={() => setSelectedNodeId(selectedRow ? null : row.nodeId)}
                    className={`w-full text-left rounded px-1 py-1 transition-colors ${
                      selectedRow
                        ? "bg-primary/10 dark:bg-primary-light/10"
                        : "hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay"
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      <span className="w-32 flex-shrink-0 truncate font-mono text-xs text-text-primary dark:text-text-primary-dark" title={row.nodeId}>
                        {row.nodeId}
                      </span>
                      <div className="relative flex-1 h-4 min-w-0 rounded bg-surface-overlay dark:bg-surface-dark-overlay">
                        <div
                          className={`absolute top-0 bottom-0 rounded ${rowColor(row.status)}`}
                          style={{ left: `${leftPct}%`, width: `${widthPct}%` }}
                        />
                      </div>
                      <span className="w-16 flex-shrink-0 text-right font-mono text-[10px] text-text-secondary dark:text-text-secondary-dark">
                        {formatTimelineDuration(row.duration)}
                      </span>
                      <StatusBadge status={timelineBadgeStatus(row.status)} size="xs" />
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Selected node detail */}
            {selected && (
              <div className="rounded border border-border dark:border-border-dark bg-surface dark:bg-surface-dark p-3 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-text-primary dark:text-text-primary-dark truncate" title={selected.nodeId}>
                    {selected.nodeId}
                  </span>
                  <StatusBadge status={timelineBadgeStatus(selected.status)} size="xs" label={selected.status} />
                </div>
                <div className="flex flex-wrap gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
                  <span>
                    Duration: <span className="font-mono">{formatTimelineDuration(selected.duration)}</span>
                  </span>
                  {selected.startedAt && (
                    <span>
                      Started: <span className="font-mono">{new Date(selected.startedAt).toLocaleTimeString()}</span>
                    </span>
                  )}
                  {selected.completedAt && (
                    <span>
                      Finished: <span className="font-mono">{new Date(selected.completedAt).toLocaleTimeString()}</span>
                    </span>
                  )}
                  {selected.statusCode !== undefined && (
                    <Badge variant="info" size="sm">
                      {selected.statusCode}
                    </Badge>
                  )}
                </div>
                {selected.error && (
                  <pre className="text-xs font-mono text-status-error dark:text-status-error bg-status-error/10 dark:bg-[var(--aw-status-error)]/10 rounded p-2 overflow-x-auto whitespace-pre-wrap break-all">
                    {selected.error}
                  </pre>
                )}
                {selected.secretRefs.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted dark:text-text-muted-dark">
                      Secrets referenced
                    </div>
                    <SecretResolutionIndicator
                      secretRefs={selected.secretRefs}
                      resolvedSecrets={resolvedSecrets}
                    />
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}
