import { OpenNodeEditorButton } from "../atoms/flow/OpenNodeEditorButton";
import { BrowserScreenshot } from "../molecules/BrowserScreenshot";
import useSidebarStore from "../../stores/SidebarStore";
import { browserStepFacts } from "../../utils/browserStep";
import type { BrowserNodeBodyProps } from "../../types";

const LABEL_CLASS = "shrink-0 text-text-secondary dark:text-text-secondary-dark";
const VALUE_CLASS = "min-w-0 break-all font-mono text-(--aw-node-text-muted)";

/**
 * An expanded browser step: the page the last run left behind, on the canvas.
 * The screenshot opens the node editor, whose result pane adds the page's
 * accessibility tree and Playwright's message.
 */
export function BrowserNodeBody({ nodeId, status, summary, result }: BrowserNodeBodyProps) {
  const workspaceId = useSidebarStore((state) => state.activeWorkspaceId);
  const step = result?.browser;
  const screenshotId = step?.screenshotArtifactId;
  const facts = browserStepFacts(step);
  const error = result?.error ?? "";

  return (
    <div className="w-node space-y-2 border-t border-border p-3 text-xs dark:border-border-dark">
      {/* Expanded, BaseNode drops the rest line; before a run nothing else says what the step does. */}
      {status === "idle" && (
        <div className="flex items-baseline gap-1.5 font-mono leading-tight">
          <span className={LABEL_CLASS}>{summary.operation}</span>
          <span className={VALUE_CLASS}>{summary.argument}</span>
        </div>
      )}

      {result === undefined && status !== "running" && (
        <p className="text-(--aw-node-text-muted)">Run the workflow to see the page after this step.</p>
      )}

      {error !== "" && (
        <p role="alert" className="text-status-error dark:text-(--aw-status-error)">
          {error}
        </p>
      )}

      {screenshotId !== undefined && workspaceId && (
        <OpenNodeEditorButton
          nodeId={nodeId}
          label={<BrowserScreenshot workspaceId={workspaceId} artifactId={screenshotId} />}
          ariaLabel="Screenshot of the page after the step: open the step's full result"
          className="block w-full"
        />
      )}

      {step?.evidenceNote !== undefined && <p className="text-(--aw-node-text-muted)">{step.evidenceNote}</p>}

      {facts.length > 0 && (
        <dl className="space-y-1">
          {facts.map(([label, value]) => (
            <div key={label} className="flex gap-1.5">
              <dt className={LABEL_CLASS}>{label}</dt>
              <dd className={VALUE_CLASS}>{value}</dd>
            </div>
          ))}
        </dl>
      )}

      {result !== undefined && (
        <OpenNodeEditorButton nodeId={nodeId} label="Full result" ariaLabel="Open the step's full result" className="text-xs" />
      )}
    </div>
  );
}
