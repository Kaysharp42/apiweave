import { useCallback, useEffect, useState } from "react";
import { Download, History, Play, Square } from "lucide-react";
import { toast } from "sonner";
import type { ProjectRun } from "@shared/types/ProjectRun";
import type { ProjectRunItem } from "@shared/types/ProjectRunItem";
import type { ReportFormat } from "@shared/types/ReportFormat";
import { Button } from "../atoms/Button";
import { Card } from "../molecules/Card";
import { FormField } from "../molecules/FormField";
import { StatusBadge } from "../molecules/StatusBadge";
import useEnvironmentStore from "../../stores/EnvironmentStore";
import { apiweave, onProjectRunChanged } from "../../utils/apiweaveClient";
import { downloadReport } from "../../utils/downloadFile";
import { formatDuration } from "../../utils/formatNodeMetrics";
import { formatTimestamp } from "../../utils/formatTimestamp";
import { MOVE_DIALOG_SELECT_CLASS } from "./moveDialogClasses";
import type { ProjectRunPanelProps, StatusBadgeProps } from "../../types";

const NO_ENVIRONMENT = "";

const STATUS_BADGE: Record<
  ProjectRunItem["status"],
  { status: StatusBadgeProps["status"]; label: string }
> = {
  pending: { status: "idle", label: "Pending" },
  running: { status: "running", label: "Running" },
  completed: { status: "success", label: "Passed" },
  failed: { status: "error", label: "Failed" },
  cancelled: { status: "warning", label: "Cancelled" },
  interrupted: { status: "warning", label: "Interrupted" },
  skipped: { status: "skipped", label: "Skipped" },
};

/** Card's icon slot takes `className?: string`, which a Lucide icon's props do not satisfy as-is. */
function PlayCardIcon({ className }: { className?: string }) {
  return <Play className={className} />;
}

function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Newest first; a changed record replaces its old copy in place. */
function upsert(runs: readonly ProjectRun[], run: ProjectRun): ProjectRun[] {
  return runs.some((existing) => existing.projectRunId === run.projectRunId)
    ? runs.map((existing) =>
        existing.projectRunId === run.projectRunId ? run : existing,
      )
    : [run, ...runs];
}

/**
 * Run a project's enabled workflows in order against one environment, follow
 * the run live, and look back at earlier project runs.
 */
export function ProjectRunPanel({
  workspaceId,
  projectId,
  onOpenRun,
}: ProjectRunPanelProps) {
  const environments = useEnvironmentStore((state) => state.environments);
  const loadedWorkspaceId = useEnvironmentStore(
    (state) => state.loadedWorkspaceId,
  );
  const [environmentId, setEnvironmentId] = useState<string | null>(null);
  const [runs, setRuns] = useState<ProjectRun[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (loadedWorkspaceId !== workspaceId) {
      void useEnvironmentStore.getState().fetchEnvironments(workspaceId);
    }
  }, [loadedWorkspaceId, workspaceId]);

  // The workspace default environment, until the user picks one.
  const chosenEnvironmentId =
    environmentId ??
    environments.find((environment) => environment.isDefault)?.environmentId ??
    NO_ENVIRONMENT;

  const loadRuns = useCallback(async () => {
    try {
      const { items } = await apiweave.projects.listRuns(
        workspaceId,
        projectId,
      );
      setRuns([...items]);
    } catch {
      setRuns([]);
    }
  }, [workspaceId, projectId]);

  useEffect(() => {
    void loadRuns();
  }, [loadRuns]);

  // Every write of a project run arrives here — including one an agent started.
  useEffect(
    () =>
      onProjectRunChanged((run) => {
        if (run.projectId === projectId) setRuns((prev) => upsert(prev, run));
      }),
    [projectId],
  );

  const selected =
    runs.find((run) => run.projectRunId === selectedRunId) ?? runs[0] ?? null;
  const isRunning = runs.some((run) => run.status === "running");

  const startRun = async (): Promise<void> => {
    setIsStarting(true);
    try {
      const run = await apiweave.projects.run(
        workspaceId,
        projectId,
        chosenEnvironmentId === NO_ENVIRONMENT ? null : chosenEnvironmentId,
      );
      setRuns((prev) => upsert(prev, run));
      setSelectedRunId(run.projectRunId);
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Failed to start the project run"));
    } finally {
      setIsStarting(false);
    }
  };

  const cancelRun = async (projectRunId: string): Promise<void> => {
    try {
      await apiweave.projects.cancelRun(workspaceId, projectRunId);
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Failed to cancel the project run"));
    }
  };

  const exportReport = async (
    projectRunId: string,
    format: ReportFormat,
  ): Promise<void> => {
    try {
      const report = await apiweave.projects.runReport(
        workspaceId,
        projectRunId,
        format,
      );
      downloadReport(`apiweave-project-run-${projectRunId}`, format, report);
    } catch (error: unknown) {
      toast.error(errorMessage(error, "Failed to export the report"));
    }
  };

  const environmentName = (id: string | null): string =>
    id === null
      ? "No environment"
      : (environments.find((environment) => environment.environmentId === id)
          ?.name ?? "Unknown environment");

  return (
    <Card title="Project runs" icon={PlayCardIcon}>
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <FormField label="Environment" className="max-w-xs">
            <select
              aria-label="Environment for the project run"
              className={MOVE_DIALOG_SELECT_CLASS}
              value={chosenEnvironmentId}
              onChange={(event) => setEnvironmentId(event.target.value)}
            >
              <option value={NO_ENVIRONMENT}>No environment</option>
              {environments.map((environment) => (
                <option
                  key={environment.environmentId}
                  value={environment.environmentId}
                >
                  {environment.name}
                </option>
              ))}
            </select>
          </FormField>
          <Button
            variant="primary"
            intent="success"
            size="sm"
            icon={<Play className="w-4 h-4" />}
            loading={isStarting}
            disabled={isStarting || isRunning}
            onClick={() => void startRun()}
          >
            Run project
          </Button>
          {selected?.status === "running" && (
            <Button
              variant="outline"
              intent="error"
              size="sm"
              icon={<Square className="w-4 h-4" />}
              onClick={() => void cancelRun(selected.projectRunId)}
            >
              Cancel
            </Button>
          )}
        </div>

        {selected && (
          <section aria-label="Workflows in this project run">
            <div className="mb-2 flex items-center gap-2 text-xs text-text-secondary dark:text-text-secondary-dark">
              <StatusBadge {...STATUS_BADGE[selected.status]} />
              <span>
                {formatTimestamp(selected.startedAt)} ·{" "}
                {environmentName(selected.environmentId)}
              </span>
              {selected.status !== "running" &&
                selected.status !== "pending" && (
                <span className="ml-auto flex gap-1">
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={<Download className="w-3.5 h-3.5" />}
                    onClick={() =>
                      void exportReport(selected.projectRunId, "junit")
                    }
                  >
                    JUnit XML
                  </Button>
                  <Button
                    variant="ghost"
                    size="xs"
                    icon={<Download className="w-3.5 h-3.5" />}
                    onClick={() =>
                      void exportReport(selected.projectRunId, "html")
                    }
                  >
                    HTML report
                  </Button>
                </span>
              )}
            </div>
            <ol className="space-y-1">
              {selected.items.map((item, index) => {
                const runId = item.runId;
                return (
                  <li
                    key={`${item.workflowId}-${index}`}
                    className="flex items-center gap-3 rounded-sm border border-border px-3 py-2 dark:border-border-dark"
                  >
                    <span className="w-5 text-xs text-text-muted dark:text-text-muted-dark">
                      {index + 1}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-sm text-text-primary dark:text-text-primary-dark">
                      {item.workflowName}
                    </span>
                    <span className="text-xs text-text-muted dark:text-text-muted-dark">
                      {formatDuration(item.durationMs) ?? ""}
                    </span>
                    <StatusBadge {...STATUS_BADGE[item.status]} />
                    {runId !== null && (
                      <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => onOpenRun(item.workflowId, runId)}
                      >
                        Open run
                      </Button>
                    )}
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {runs.length > 1 && (
          <section aria-label="Project run history">
            <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-text-secondary dark:text-text-secondary-dark">
              <History className="w-3.5 h-3.5" aria-hidden="true" />
              History
            </h4>
            <ul className="space-y-1">
              {runs.map((run) => {
                const passed = run.items.filter(
                  (item) => item.status === "completed",
                ).length;
                return (
                  <li key={run.projectRunId}>
                    <Button
                      variant={
                        run.projectRunId === selected?.projectRunId
                          ? "secondary"
                          : "ghost"
                      }
                      size="sm"
                      fullWidth
                      aria-current={
                        run.projectRunId === selected?.projectRunId
                          ? "true"
                          : undefined
                      }
                      onClick={() => setSelectedRunId(run.projectRunId)}
                    >
                      <span className="flex w-full items-center gap-3 text-left">
                        <StatusBadge {...STATUS_BADGE[run.status]} size="xs" />
                        <span className="flex-1 truncate">
                          {formatTimestamp(run.startedAt)} ·{" "}
                          {environmentName(run.environmentId)}
                        </span>
                        <span className="text-xs text-text-muted dark:text-text-muted-dark">
                          {passed}/{run.items.length} passed
                        </span>
                      </span>
                    </Button>
                  </li>
                );
              })}
            </ul>
          </section>
        )}
      </div>
    </Card>
  );
}
