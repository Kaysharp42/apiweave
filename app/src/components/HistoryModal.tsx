import {
  useState,
  useEffect,
  useReducer,
  useRef,
  useCallback,
  useSyncExternalStore,
} from "react";
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
} from "lucide-react";
import { authenticatedFetch } from "../utils/apiweaveClient";
import { workflowRunsListUrl } from "../utils/apiweaveClient";
import type { RunRecord, HistoryModalProps } from "../types";

interface PaginationInfo {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  hasNext: boolean;
  hasPrevious: boolean;
}

interface RunHistoryResponse {
  runs: RunRecord[];
  total: number;
}

type RequestStatus = "loading" | "idle";

interface RequestState {
  status: RequestStatus;
}

type RequestAction = { type: "start-loading" } | { type: "finish-loading" };

interface HistoryModalStoreState {
  runs: RunRecord[];
  pagination: PaginationInfo;
  isLoading: boolean;
}

const initialPagination: PaginationInfo = {
  page: 1,
  limit: 10,
  total: 0,
  totalPages: 0,
  hasNext: false,
  hasPrevious: false,
};

const historyModalStore: HistoryModalStoreState = {
  runs: [],
  pagination: initialPagination,
  isLoading: true,
};

const historyModalListeners = new Set<() => void>();

function emitHistoryModalStoreUpdate(): void {
  historyModalListeners.forEach((listener) => listener());
}

function subscribeToHistoryModalStore(listener: () => void): () => void {
  historyModalListeners.add(listener);
  return () => historyModalListeners.delete(listener);
}

function setHistoryModalStoreState(
  nextState: Partial<HistoryModalStoreState>,
): void {
  if (nextState.runs !== undefined) {
    historyModalStore.runs = nextState.runs;
  }
  if (nextState.pagination !== undefined) {
    historyModalStore.pagination = nextState.pagination;
  }
  if (nextState.isLoading !== undefined) {
    historyModalStore.isLoading = nextState.isLoading;
  }
  emitHistoryModalStoreUpdate();
}

function requestReducer(
  _state: RequestState,
  action: RequestAction,
): RequestState {
  switch (action.type) {
    case "start-loading":
      return { status: "loading" };
    case "finish-loading":
      return { status: "idle" };
  }
}

export default function HistoryModal({
  workflowId,
  workspaceId,
  onClose,
  onSelectRun,
}: HistoryModalProps) {
  const [requestState, dispatchRequest] = useReducer(requestReducer, {
    status: "loading",
  });
  const [isAnimating, setIsAnimating] = useState(true);
  const modalRef = useRef<HTMLDivElement>(null);
  const loadingPageRef = useRef<number>(1);
  const isLoading = requestState.status === "loading";
  const snapshot = useSyncExternalStore(
    subscribeToHistoryModalStore,
    () => historyModalStore,
    () => historyModalStore,
  );
  const { runs, pagination } = snapshot;
  const handleClose = useCallback(() => {
    setIsAnimating(false);
    setTimeout(onClose, 200);
  }, [onClose]);

  const fetchRunHistory = useCallback(
    async (page = 1) => {
      dispatchRequest({ type: "start-loading" });
      setHistoryModalStoreState({ isLoading: true });
      try {
        const limit = 10;
        const response = await authenticatedFetch(
          workflowRunsListUrl(workspaceId, workflowId, page, limit),
        );
        if (response.ok) {
          const data: RunHistoryResponse = await response.json();
          // The runs route returns the full unpaginated set with a total
          // count; paginate it client-side since the backend ignores
          // page/limit query params.
          const totalPages = Math.max(1, Math.ceil(data.total / limit));
          const clampedPage = Math.min(Math.max(page, 1), totalPages);
          const start = (clampedPage - 1) * limit;
          setHistoryModalStoreState({
            runs: data.runs.slice(start, start + limit),
            pagination: {
              page: clampedPage,
              limit,
              total: data.total,
              totalPages,
              hasNext: clampedPage < totalPages,
              hasPrevious: clampedPage > 1,
            },
          });
        }
      } catch {
        // Silently fail - will retry on next fetch
      } finally {
        dispatchRequest({ type: "finish-loading" });
        setHistoryModalStoreState({ isLoading: false });
      }
    },
    [workspaceId, workflowId],
  );

  useEffect(() => {
    fetchRunHistory(1);
  }, [fetchRunHistory]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
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
  }, [handleClose]);

  const handlePageChange = (newPage: number) => {
    fetchRunHistory(newPage);
  };

  const handleRunClick = (run: RunRecord) => {
    onSelectRun(run);
    handleClose();
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

  const formatDuration = (duration?: number): string => {
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
                  {pagination.total} run{pagination.total !== 1 ? "s" : ""}{" "}
                  total
                  {pagination.totalPages > 1 && (
                    <>
                      {" • "}Showing{" "}
                      {(pagination.page - 1) * pagination.limit + 1}-
                      {Math.min(
                        pagination.page * pagination.limit,
                        pagination.total,
                      )}
                    </>
                  )}
                </p>
              </div>
            </div>
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
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <div className="flex flex-col items-center gap-3">
                <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-primary"></div>
                <p className="text-sm text-text-muted dark:text-text-muted-dark">
                  {loadingPageRef.current && loadingPageRef.current > 1
                    ? "Loading page…"
                    : "Loading history…"}
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
                <button
                  type="button"
                  key={run.runId}
                  onClick={() => handleRunClick(run)}
                  className="w-full px-5 py-4 hover:bg-surface dark:hover:bg-surface-dark-raised transition-colors text-left"
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

                      {run.status === "failed" && run.error && (
                        <div className="mt-2 text-xs">
                          {run.error.includes("Assertion failed") ? (
                            <div className="text-status-error dark:text-status-error">
                              <div className="font-semibold mb-1">
                                {run.error.includes("/") &&
                                run.error.match(/(\d+)\/(\d+)/)?.[0]
                                  ? `Assertion: ${run.error.match(/(\d+)\/(\d+)/)?.[0]} failed`
                                  : "Assertion failed"}
                              </div>
                              <div className="truncate">
                                {run.error.split("\n")[0]}
                              </div>
                            </div>
                          ) : run.error.includes("branches failed") ? (
                            <div className="text-status-error dark:text-status-error">
                              <div className="font-semibold">{run.error}</div>
                            </div>
                          ) : (
                            <div className="text-status-error dark:text-status-error truncate">
                              Error: {run.error}
                            </div>
                          )}
                        </div>
                      )}
                      {run.status === "failed" &&
                        run.failedNodes &&
                        run.failedNodes.length > 0 && (
                          <div className="mt-1 text-xs text-status-warning dark:text-status-warning">
                            {run.failedNodes.length} node
                            {run.failedNodes.length > 1 ? "s" : ""} failed
                          </div>
                        )}
                    </div>

                    <div className="flex-shrink-0 text-text-muted dark:text-text-muted-dark">
                      <ChevronRight className="w-5 h-5" />
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex-shrink-0 px-5 py-3 border-t border-border dark:border-border-dark bg-surface dark:bg-surface-dark">
          {!isLoading && runs.length > 0 && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between">
              <button
                type="button"
                onClick={() => handlePageChange(pagination.page - 1)}
                disabled={!pagination.hasPrevious || isLoading}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-text-primary dark:text-text-primary-dark bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Previous
              </button>

              <span className="text-sm text-text-secondary dark:text-text-primary-dark">
                Page {pagination.page} of {pagination.totalPages}
              </span>

              <button
                type="button"
                onClick={() => handlePageChange(pagination.page + 1)}
                disabled={!pagination.hasNext || isLoading}
                className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-text-primary dark:text-text-primary-dark bg-surface-raised dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              >
                Next
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
