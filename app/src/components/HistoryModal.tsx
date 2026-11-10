import { useState, useEffect, useCallback } from "react";
import {
  ClipboardList,
  ChevronRight,
  Timer,
  Zap,
  Activity,
  Trash2,
  FileCode,
  FileText,
  FileSpreadsheet,
  RotateCcw,
  CornerDownRight,
} from "lucide-react";
import type { ReportFormat } from "@shared/types/ReportFormat";
import type { RunSummary } from "@shared/types/RunSummary";
import { apiweave } from "../utils/apiweaveClient";
import { downloadReport } from "../utils/downloadFile";
import { IconButton } from "./atoms/IconButton";
import { Button } from "./atoms/Button";
import { Spinner } from "./atoms/Spinner";
import { ConfirmDialog } from "./molecules/ConfirmDialog";
import { EmptyState } from "./molecules/EmptyState";
import { Modal } from "./molecules/Modal";
import { StatusBadge } from "./molecules/StatusBadge";
import type { HistoryModalProps, StatusBadgeProps } from "../types";

const PAGE_SIZE = 20;
/** How each run status reads as a badge. Running is amber, never the accent. */
const RUN_STATUS_BADGE: Record<
  RunSummary["status"],
  { status: StatusBadgeProps["status"]; label: string }
> = {
  pending: { status: "idle", label: "Pending" },
  running: { status: "running", label: "Running" },
  completed: { status: "success", label: "Completed" },
  failed: { status: "error", label: "Failed" },
  cancelled: { status: "skipped", label: "Cancelled" },
  interrupted: { status: "warning", label: "Interrupted" },
};
const LIVE_STATUSES: ReadonlySet<RunSummary["status"]> = new Set([
  "pending",
  "running",
]);

type PendingDelete = { kind: "run"; runId: string } | { kind: "clear" };

export default function HistoryModal({
  workflowId,
  workspaceId,
  highlightRunId,
  onClose,
  onSelectRun,
  onShowTimeline,
  onRerunFailed,
}: HistoryModalProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );

  // History rows are summaries — status, timing, failure counts. The full run,
  // node results and bodies included, is fetched only when one is opened.
  const fetchRunHistory = useCallback(
    async (cursor?: string) => {
      setIsLoading(true);
      setError(null);
      try {
        const page = await apiweave.runs.history({
          workspaceId,
          workflowId,
          limit: PAGE_SIZE,
          ...(cursor !== undefined ? { cursor } : {}),
        });
        setRuns((current) =>
          cursor === undefined ? page.items : [...current, ...page.items],
        );
        setNextCursor(page.nextCursor);
      } catch {
        setError("Could not load run history.");
      } finally {
        setIsLoading(false);
      }
    },
    [workspaceId, workflowId],
  );

  useEffect(() => {
    void fetchRunHistory();
  }, [fetchRunHistory]);

  const handleRunClick = (run: RunSummary) => {
    onSelectRun(run);
    onClose();
  };

  const confirmDelete = async () => {
    const target = pendingDelete;
    setPendingDelete(null);
    if (target === null) return;
    try {
      if (target.kind === "run") {
        await apiweave.runs.delete(workspaceId, target.runId);
      } else {
        await apiweave.runs.clearHistory(workspaceId, workflowId);
      }
    } catch {
      setError("Could not delete run history.");
      return;
    }
    // Deleting changes the history, so any cursor already issued is stale.
    await fetchRunHistory();
  };

  // Built from the stored, masked run on demand; nothing is kept on disk.
  const exportReport = async (runId: string, format: ReportFormat) => {
    try {
      const report = await apiweave.runs.report(workspaceId, runId, format);
      downloadReport(`apiweave-run-${runId}`, format, report);
    } catch {
      setError("Could not export the run report.");
    }
  };

  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60)
      return `${diffMins} minute${diffMins > 1 ? "s" : ""} ago`;
    if (diffHours < 24)
      return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
    if (diffDays < 7) return `${diffDays} day${diffDays > 1 ? "s" : ""} ago`;

    return date.toLocaleDateString() + " " + date.toLocaleTimeString();
  };

  const formatDuration = (duration: number | null | undefined): string => {
    if (!duration) return "--";
    if (duration < 1000) return `${duration}ms`;
    return `${(duration / 1000).toFixed(2)}s`;
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Run history"
      headerExtra={
        runs.length > 0 && (
          <Button
            variant="ghost"
            intent="error"
            size="xs"
            icon={<Trash2 className="w-3.5 h-3.5" />}
            onClick={() => setPendingDelete({ kind: "clear" })}
          >
            Clear history
          </Button>
        )
      }
      footer={
        nextCursor !== null && (
          <Button
            variant="outline"
            size="sm"
            fullWidth
            loading={isLoading}
            onClick={() => void fetchRunHistory(nextCursor)}
          >
            Load more
          </Button>
        )
      }
    >
      <p className="px-5 pt-3 text-xs text-text-secondary dark:text-text-secondary-dark">
        {runs.length}
        {nextCursor !== null ? "+" : ""} run
        {runs.length !== 1 || nextCursor !== null ? "s" : ""}, newest first
      </p>
      {error !== null && (
        <p
          role="alert"
          className="px-5 py-2 text-xs text-status-error dark:text-status-error"
        >
          {error}
        </p>
      )}
      {isLoading && runs.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-3 py-12">
          <Spinner size="lg" />
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Loading history…
          </p>
        </div>
      ) : runs.length === 0 ? (
        <EmptyState
          icon={
            <ClipboardList
              className="w-12 h-12 text-text-muted dark:text-text-muted-dark"
              strokeWidth={1.5}
              aria-hidden="true"
            />
          }
          title="No runs yet"
          description="Run this workflow to see its results here."
        />
      ) : (
        <div
          className={`divide-y divide-border dark:divide-border-dark transition-opacity ${isLoading ? "opacity-50" : "opacity-100"}`}
        >
          {runs.map((run) => {
            const isHighlighted = run.runId === highlightRunId;
            const badge = RUN_STATUS_BADGE[run.status];
            return (
              <div
                key={run.runId}
                // Bring the jumped-to run into view. Rows render once per
                // page load, so this runs on the row that appears, not on
                // every render.
                ref={
                  isHighlighted
                    ? (el) => el?.scrollIntoView({ block: "center" })
                    : null
                }
                {...(isHighlighted && { "data-highlighted": "true" })}
                className={`flex items-start gap-2 pr-5 hover:bg-surface dark:hover:bg-surface-dark-raised transition-colors${
                  isHighlighted
                    ? " bg-primary/5 dark:bg-primary-light/10 ring-1 ring-inset ring-primary dark:ring-primary-light"
                    : ""
                }`}
              >
                <button
                  type="button"
                  onClick={() => handleRunClick(run)}
                  aria-current={isHighlighted ? "true" : undefined}
                  className="flex-1 min-w-0 px-5 py-4 text-left cursor-pointer focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--aw-primary)"
                >
                  <span className="flex items-center gap-2 mb-2">
                    <StatusBadge status={badge.status} label={badge.label} />
                    <span className="text-xs text-text-secondary dark:text-text-secondary-dark">
                      {formatDate(run.createdAt)}
                    </span>
                    {isHighlighted && (
                      <span className="text-2xs font-medium uppercase tracking-wide text-primary dark:text-primary-light">
                        Linked run
                      </span>
                    )}
                  </span>

                  <span className="flex items-center gap-4 text-xs text-text-secondary dark:text-text-secondary-dark">
                    <span className="flex items-center gap-1">
                      <Timer className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{formatDuration(run.duration)}</span>
                    </span>
                    {run.trigger && (
                      <span className="flex items-center gap-1">
                        <Zap className="w-3.5 h-3.5" aria-hidden="true" />
                        <span className="capitalize">{run.trigger}</span>
                      </span>
                    )}
                    {run.resumeFromRunId && (
                      <span
                        className="flex items-center gap-1"
                        title={`Reused results from run ${run.resumeFromRunId}`}
                      >
                        <CornerDownRight className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Rerun of {run.resumeFromRunId.slice(0, 8)}</span>
                      </span>
                    )}
                    {run.iteration && (
                      <span className="flex items-center gap-1">
                        <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>
                          Iteration {run.iteration.index}/{run.iteration.count}
                        </span>
                      </span>
                    )}
                  </span>

                  {run.status === "failed" && run.failedNodeCount > 0 && (
                    <span className="block mt-1 text-xs text-status-warning dark:text-status-warning">
                      {run.failedNodeCount} node
                      {run.failedNodeCount > 1 ? "s" : ""} failed
                    </span>
                  )}
                </button>

                <div className="shrink-0 flex items-center gap-1 pt-4 text-text-muted dark:text-text-muted-dark">
                  {onShowTimeline && (
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        onShowTimeline(run.runId);
                      }}
                      variant="ghost"
                      size="xs"
                      tooltip="View run timeline"
                      aria-label={`View timeline for run ${run.runId}`}
                    >
                      <Activity className="w-4 h-4" />
                    </IconButton>
                  )}
                  {onRerunFailed &&
                    run.status === "failed" &&
                    run.failedNodeCount > 0 && (
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          onRerunFailed(run.runId);
                          onClose();
                        }}
                        variant="ghost"
                        size="xs"
                        tooltip="Rerun failed branches"
                        aria-label={`Rerun the failed branches of run ${run.runId}`}
                      >
                        <RotateCcw className="w-4 h-4" />
                      </IconButton>
                    )}
                  {!LIVE_STATUSES.has(run.status) && (
                    <>
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          void exportReport(run.runId, "junit");
                        }}
                        variant="ghost"
                        size="xs"
                        tooltip="Export JUnit XML report"
                        aria-label={`Export JUnit XML report for run ${run.runId}`}
                      >
                        <FileCode className="w-4 h-4" />
                      </IconButton>
                      <IconButton
                        onClick={(e) => {
                          e.stopPropagation();
                          void exportReport(run.runId, "html");
                        }}
                        variant="ghost"
                        size="xs"
                        tooltip="Export HTML report"
                        aria-label={`Export HTML report for run ${run.runId}`}
                      >
                        <FileText className="w-4 h-4" />
                      </IconButton>
                    </>
                  )}
                  {!LIVE_STATUSES.has(run.status) && (
                    <IconButton
                      onClick={(e) => {
                        e.stopPropagation();
                        setPendingDelete({ kind: "run", runId: run.runId });
                      }}
                      variant="ghost"
                      size="xs"
                      tooltip="Delete run"
                      aria-label={`Delete run ${run.runId}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </IconButton>
                  )}
                  <ChevronRight className="w-5 h-5" aria-hidden="true" />
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => void confirmDelete()}
        title={
          pendingDelete?.kind === "clear" ? "Clear run history" : "Delete run"
        }
        message={
          pendingDelete?.kind === "clear"
            ? "Delete every finished run of this workflow, with its results? Runs still in progress are kept. This cannot be undone."
            : "Delete this run and its results? This cannot be undone."
        }
        confirmLabel="Delete"
        intent="error"
      />
    </Modal>
  );
}
