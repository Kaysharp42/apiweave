import { useEffect, useState } from "react";
import { Accessibility, Camera, FileText, Scale } from "lucide-react";
import { Card } from "../molecules/Card";
import { DetailField } from "../molecules/DetailField";
import { EmptyState } from "../molecules/EmptyState";
import { StatusBadge } from "../molecules/StatusBadge";
import { Spinner } from "../atoms/Spinner";
import { apiweave, IpcError } from "../../utils/apiweaveClient";
import { formatDuration } from "../../utils/formatNodeMetrics";
import type { BrowserOutputPanelProps, StatusBadgeProps } from "../../types";

function createCardIcon(Icon: typeof Camera) {
  return function CardIcon({ className }: { className?: string | undefined }) {
    return <Icon className={className} />;
  };
}

const CameraCardIcon = createCardIcon(Camera);
const ScaleCardIcon = createCardIcon(Scale);
const AccessibilityCardIcon = createCardIcon(Accessibility);

function normalizeStatus(status: string): StatusBadgeProps["status"] {
  return status === "running" || status === "success" || status === "error" || status === "warning" ? status : "idle";
}

/** The failed step's screenshot, read from the run's artifacts when the pane shows it. */
function Screenshot({ workspaceId, artifactId }: { workspaceId: string; artifactId: string }) {
  const [source, setSource] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setSource(null);
    setError(null);
    apiweave.runs
      .getArtifact(workspaceId, artifactId)
      .then((artifact) => {
        if (!cancelled) setSource(`data:${artifact.mime};base64,${artifact.base64}`);
      })
      .catch((cause: unknown) => {
        if (!cancelled) setError(cause instanceof IpcError ? cause.message : "The screenshot could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [workspaceId, artifactId]);

  if (error !== null) return <p className="text-sm text-text-secondary dark:text-text-secondary-dark">{error}</p>;
  if (source === null) return <Spinner size="sm" />;
  return (
    <img
      src={source}
      alt="The page when the step failed. Password fields are painted over."
      className="w-full rounded-xs border border-border dark:border-border-dark"
    />
  );
}

/** A browser step's result: what it compared, where the page was, and on failure what the page looked like. */
export function BrowserOutputPanel({ output, executionStatus = "idle", workspaceId }: BrowserOutputPanelProps) {
  const step = output?.browser;
  const screenshotId = step?.screenshotArtifactId;

  return (
    <div className="flex h-full min-h-0 flex-col bg-surface dark:bg-surface-dark">
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border bg-surface-raised px-4 py-3 dark:border-border-dark dark:bg-surface-dark-raised">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-4 w-4 text-text-muted dark:text-text-muted-dark" aria-hidden="true" />
          <h3 className="font-mono text-xs font-semibold uppercase tracking-wide text-text-primary dark:text-text-primary-dark">Step result</h3>
        </div>
        <StatusBadge status={normalizeStatus(executionStatus)} size="sm" />
      </div>

      {output === null || output === undefined ? (
        <div className="flex min-h-0 flex-1 items-center justify-center p-6">
          <EmptyState
            icon={<FileText className="h-12 w-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />}
            title="No result yet"
            description="Run the workflow to see what the page did."
            className="min-h-40 py-8"
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-4 overflow-auto p-4">
          {typeof output.error === "string" && output.error !== "" ? (
            <p role="alert" className="text-sm text-status-error dark:text-(--aw-status-error)">{output.error}</p>
          ) : null}

          <div className="grid gap-3 sm:grid-cols-2">
            {step?.title !== undefined ? <DetailField label="Page title">{step.title}</DetailField> : null}
            {step?.url !== undefined ? <DetailField label="Page address" mono breakAll>{step.url}</DetailField> : null}
            <DetailField label="Duration">{formatDuration(output.duration) ?? "—"}</DetailField>
          </div>

          {step?.expected !== undefined || step?.actual !== undefined ? (
            <Card title={step?.expected !== undefined ? "Expected and found" : "Value read"} icon={ScaleCardIcon}>
              <div className="grid gap-3 sm:grid-cols-2">
                {step?.expected !== undefined ? <DetailField label="Expected" mono breakAll>{step.expected}</DetailField> : null}
                <DetailField label={step?.expected !== undefined ? "Found" : "Value"} mono breakAll>{step?.actual ?? "(nothing: the element was not found)"}</DetailField>
              </div>
            </Card>
          ) : null}

          {screenshotId !== undefined && workspaceId ? (
            <Card title="Screenshot" icon={CameraCardIcon}>
              <Screenshot workspaceId={workspaceId} artifactId={screenshotId} />
            </Card>
          ) : null}

          {step?.evidenceNote !== undefined ? (
            <p className="text-xs text-text-secondary dark:text-text-secondary-dark">{step.evidenceNote}</p>
          ) : null}

          {step?.ariaSnapshot !== undefined ? (
            <Card title="Page structure (accessibility tree)" icon={AccessibilityCardIcon}>
              <pre className="max-h-96 overflow-auto rounded-xs border border-border bg-surface-overlay p-3 font-mono text-xs leading-relaxed text-text-primary whitespace-pre-wrap dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-primary-dark">
                {step.ariaSnapshot}
              </pre>
            </Card>
          ) : null}

          {step?.detail !== undefined ? (
            <Card title="Playwright's message" icon={ScaleCardIcon}>
              <pre className="max-h-64 overflow-auto font-mono text-xs leading-relaxed text-text-secondary whitespace-pre-wrap dark:text-text-secondary-dark">{step.detail}</pre>
            </Card>
          ) : null}
        </div>
      )}
    </div>
  );
}
