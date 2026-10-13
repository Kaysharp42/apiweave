import { useState, useEffect, useRef, useCallback } from "react";
import {
  CheckCircle,
  XCircle,
  RefreshCw,
  Clock,
  Circle,
  History,
  X,
  ClipboardList,
  ChevronRight,
  Timer,
  Zap,
  Activity,
  Trash2,
} from "lucide-react";
import type { RunSummary } from "@shared/types/RunSummary";
import { apiweave } from "../utils/apiweaveClient";
import { IconButton } from "./atoms/IconButton";
import { Button } from "./atoms/Button";
import { ConfirmDialog } from "./molecules/ConfirmDialog";
import type { HistoryModalProps } from "../types";

const PAGE_SIZE = 20;
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
}: HistoryModalProps) {
  const [runs, setRuns] = useState<RunSummary[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(
    null,
  );
  const [isAnimating, setIsAnimating] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);
  const handleClose = useCallback(() => {
    setIsAnimating(false);
    setTimeout(onClose, 200);
  }, [onClose]);

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

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      // The confirm dialog renders in a portal outside this panel.
      if (pendingDelete !== null) return;
      if (
        modalRef.current &&
        !modalRef.current.contains(event.target as Node)
      ) {
        handleClose();
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [handleClose, pendingDelete]);

  const handleRunClick = (run: RunSummary) => {
    onSelectRun(run);
    handleClose();
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

  const getStatusColor = (status: string): string => {
    switch (status) {
      case "completed":
        return "bg-status-success/10 text-status-success dark:bg-status-success/20 dark:text-status-success";
      case "failed":
        return "bg-status-error/10 text-status-error dark:bg-status-error/20 dark:text-status-error";
      case "running":
        return "bg-primary/10 text-primary dark:bg-primary/20 dark:text-primary-dark";
      case "pending":
        return "bg-status-warning/10 text-status-warning dark:bg-status-warning/20 dark:text-status-warning";
      default:
        return "bg-surface dark:bg-surface-dark-raised text-text-secondary dark:text-text-primary-dark";
    }
  };

  const getStatusIcon = (status: string) => {
    const iconProps = { className: "w-3 h-3" };
    switch (status) {
      case "completed":
        return <CheckCircle {...iconProps} />;
      case "failed":
        return <XCircle {...iconProps} />;
      case "running":
        return <RefreshCw {...iconProps} className="w-3 h-3 animate-spin" />;
      case "pending":
        return <Clock {...iconProps} />;
      default:
        return <Circle {...iconProps} />;
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
    <div
      className={`fixed inset-0 z-50 flex items-start justify-end pt-40 pr-4 transition-opacity duration-300 bg-[var(--aw-surface)]/30 ${
        isAnimating ? "opacity-100" : "opacity-0 pointer-events-none"
      }`}
    >
      <button
        type="button"
        aria-label="Close run history"
        className="absolute inset-0 cursor-pointer"
        onClick={handleClose}
      />

      <div
        ref={modalRef}
        className="relative z-10 bg-surface-raised dark:bg-surface-dark-raised rounded border border-border dark:border-border-dark overflow-hidden transition-transform duration-300 flex flex-col"
        style={{
          width: "500px",
          maxHeight: "600px",
          transform: isAnimating ? "translateY(0)" : "translateY(-20px)",
        }}
      >
        <div className="flex-shrink-0 px-5 py-4 border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded">
                <History className="w-5 h-5 text-primary dark:text-primary-light" />
              </div>
              <div>
                <h2 className="text-lg font-semibold text-text-primary dark:text-text-primary-dark">
                  Run History
                </h2>
                <p className="text-xs text-text-muted dark:text-text-muted-dark">
                  {runs.length}
                  {nextCursor !== null ? "+" : ""} run
                  {runs.length !== 1 || nextCursor !== null ? "s" : ""}, newest
                  first
                </p>
              </div>
            </div>
            {runs.length > 0 && (
              <Button
                variant="ghost"
                intent="error"
                size="xs"
                icon={<Trash2 className="w-3.5 h-3.5" />}
                onClick={() => setPendingDelete({ kind: "clear" })}
              >
                Clear history
              </Button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className="p-2 text-text-muted hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors rounded"
              title="Close"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {error !== null && (
            <p
              role="alert"
              className="px-5 py-2 text-xs text-status-error dark:text-status-error"
            >
              {error}
            </p>
          )}
          {isLoading && runs.length === 0 ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                <p className="text-sm text-text-muted dark:text-text-muted-dark">
                  Loading history…
                </p>
              </div>
            </div>
          ) : runs.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6">
              <ClipboardList className="w-16 h-16 text-text-muted dark:text-text-muted-dark/50 mb-4" />
              <p className="text-sm font-medium text-text-secondary dark:text-text-primary-dark mb-1">
                No runs yet
              </p>
              <p className="text-xs text-text-muted dark:text-text-muted-dark text-center">
                Click the Run button to execute this workflow
              </p>
            </div>
          ) : (
            <div
              className={`divide-y divide-border dark:divide-border-dark transition-opacity ${isLoading ? "opacity-50" : "opacity-100"}`}
            >
              {runs.map((run) => (
                <div
                  key={run.runId}
                  role="button"
                  tabIndex={0}
                  // Bring the jumped-to run into view. Rows render once per
                  // page load, so this runs on the row that appears, not on
                  // every render.
                  ref={
                    run.runId === highlightRunId
                      ? (el) => el?.scrollIntoView({ block: "center" })
                      : null
                  }
                  {...(run.runId === highlightRunId && {
                    "data-highlighted": "true",
                  })}
                  onClick={() => handleRunClick(run)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" || e.key === " ") {
                      e.preventDefault();
                      handleRunClick(run);
                    }
                  }}
                  className={`w-full px-5 py-4 hover:bg-surface dark:hover:bg-surface-dark-raised transition-colors text-left cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-primary dark:focus-visible:ring-primary-light${
                    run.runId === highlightRunId
                      ? " bg-primary/5 dark:bg-primary/10 ring-2 ring-inset ring-primary dark:ring-primary-light"
                      : ""
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-2">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-1 text-xs font-semibold rounded ${getStatusColor(run.status)}`}
                        >
                          <span>{getStatusIcon(run.status)}</span>
                          <span className="uppercase">{run.status}</span>
                        </span>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">
                          {formatDate(run.createdAt)}
                        </span>
                      </div>

                      <div className="flex items-center gap-4 text-xs text-text-secondary dark:text-text-primary-dark">
                        <div className="flex items-center gap-1">
                          <Timer className="w-3.5 h-3.5" />
                          <span>{formatDuration(run.duration)}</span>
                        </div>
                        {run.trigger && (
                          <div className="flex items-center gap-1">
                            <Zap className="w-3.5 h-3.5" />
                            <span className="capitalize">{run.trigger}</span>
                          </div>
                        )}
                      </div>

                      {run.status === "failed" && run.failedNodeCount > 0 && (
                        <div className="mt-1 text-xs text-status-warning dark:text-status-warning">
                          {run.failedNodeCount} node
                          {run.failedNodeCount > 1 ? "s" : ""} failed
                        </div>
                      )}
                    </div>

                    <div className="flex-shrink-0 flex items-center gap-1 text-text-muted dark:text-text-muted-dark">
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
                      {!LIVE_STATUSES.has(run.status) && (
                        <IconButton
                          onClick={(e) => {
                            e.stopPropagation();
                            setPendingDelete({ kind: "run", runId: run.runId });
                          }}
                          onKeyDown={(e) => e.stopPropagation()}
                          variant="ghost"
                          size="xs"
                          tooltip="Delete run"
                          aria-label={`Delete run ${run.runId}`}
                        >
                          <Trash2 className="w-4 h-4" />
                        </IconButton>
                      )}
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-5 py-3 border-t border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          {nextCursor !== null && (
            <Button
              variant="outline"
              size="sm"
              fullWidth
              loading={isLoading}
              onClick={() => void fetchRunHistory(nextCursor)}
            >
              Load more
            </Button>
          )}
        </div>
      </div>

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
    </div>
  );
}
