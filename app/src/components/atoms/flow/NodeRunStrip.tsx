import { METRIC_SEPARATOR, metricText } from "../../../utils/formatNodeMetrics";
import type { NodeRunStripProps } from "../../../types/NodeRunStripProps";
import type { NodeRunLine } from "../../../types/NodeRunLine";

/**
 * The three-row run strip: activity line, progress rail, metrics.
 *
 * Exists only once a node has run or is running — an idle node has no strip at
 * all, which is what keeps a resting canvas quiet and cheap (DESIGN.md §7).
 */

function RunLine({ line }: { line: NodeRunLine }) {
  return (
    <div className="flex items-baseline gap-1.5 font-mono text-xs leading-tight">
      <span className="flex-shrink-0 text-text-primary dark:text-text-primary-dark">
        {line.operation}
      </span>
      {line.argument && (
        <span
          className="truncate text-text-secondary dark:text-text-secondary-dark"
          title={line.argument}
        >
          {line.argument}
        </span>
      )}
    </div>
  );
}

/**
 * A 2px rail. Determinate fills to a fraction; indeterminate sweeps a partial
 * fill across the track — activity without a known end.
 *
 * `transform` only: the fill's width is fixed and it is translated, so the
 * sweep never triggers layout.
 */
function ProgressRail({ progress }: { progress: number | "indeterminate" }) {
  const indeterminate = progress === "indeterminate";
  const fraction = indeterminate
    ? 0
    : Math.max(0, Math.min(1, progress as number));

  return (
    <div
      className="h-0.5 w-full overflow-hidden rounded-node-rail bg-surface-overlay dark:bg-surface-dark-overlay"
      role="progressbar"
      aria-label="Node progress"
      {...(indeterminate
        ? {}
        : {
            "aria-valuenow": Math.round(fraction * 100),
            "aria-valuemin": 0,
            "aria-valuemax": 100,
          })}
    >
      <div
        className={[
          "aw-node-rail__fill h-full rounded-node-rail bg-[color-mix(in_srgb,var(--aw-status-running)_85%,transparent)]",
          indeterminate
            ? "aw-node-rail__fill--indeterminate w-2/5 animate-rail-sweep motion-reduce:animate-none"
            : "transition-transform duration-aw-normal ease-aw-out",
        ].join(" ")}
        {...(indeterminate
          ? {}
          : {
              style: {
                width: "100%",
                transform: `scaleX(${fraction})`,
                transformOrigin: "left",
              },
            })}
      />
    </div>
  );
}

export function NodeRunStrip({
  status,
  activityLine,
  resultSummary,
  metrics,
  progress = null,
}: NodeRunStripProps) {
  const isRunning = status === "running";
  const line = isRunning ? activityLine : (resultSummary ?? activityLine);
  const showRail = isRunning && progress !== null;
  const hasMetrics = metrics !== undefined && metrics.length > 0;

  if (!line && !showRail && !hasMetrics) return null;

  return (
    <div className="flex flex-col gap-1.5 px-3 py-2 animate-strip-enter motion-reduce:animate-none">
      {line && <RunLine line={line} />}

      {showRail && <ProgressRail progress={progress} />}

      {hasMetrics && (
        <div
          className="flex items-center gap-1.5 text-[11px] leading-none text-[var(--aw-node-text-muted)] tabular-nums"
          role="group"
          aria-label="Node metrics"
        >
          {metrics.map((metric, index) => (
            <span key={metric.label} className="flex items-center gap-1.5">
              {/* No opacity on the separator — dimming it drops it back below
                  the contrast floor the muted token exists to clear. */}
              {index > 0 && (
                <span aria-hidden="true">{METRIC_SEPARATOR}</span>
              )}
              <span
                className="truncate"
                aria-label={`${metric.label}: ${metricText(metric)}`}
              >
                {metricText(metric)}
              </span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
