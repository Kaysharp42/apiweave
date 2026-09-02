import { memo, useCallback, useMemo } from "react";
import { useReactFlow } from "@xyflow/react";
import type { CanvasNode } from "../../types/CanvasNode";
import { Clock } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import { formatDuration } from "../../utils/formatNodeMetrics";
import type { DelayNodeProps } from "../../types/DelayNodeProps";

const DelayNode = ({ id, data, selected }: DelayNodeProps) => {
  const { updateNodeData: patchNodeData } = useReactFlow<CanvasNode>();

  const updateNodeData = useCallback(
    (value: number) => {
      patchNodeData(id, (node) => ({
        config: { ...node.data.config, duration: value },
      }));
    },
    [id, patchNodeData],
  );

  const duration = data.config?.duration ?? 1000;
  const humanLabel =
    duration >= 1000 ? `${(duration / 1000).toFixed(1)}s` : `${duration}ms`;

  const icon = useMemo(() => <Clock className="w-4 h-4" />, []);

  const typeChip = useMemo(
    () => (
      <span className="flex-shrink-0 text-[11px] font-mono px-1.5 py-0.5 rounded-node-chip bg-[color-mix(in_srgb,var(--aw-status-warning)_12%,transparent)] text-[var(--aw-status-warning)]">
        {humanLabel}
      </span>
    ),
    [humanLabel],
  );

  const status = data.executionStatus ?? "idle";

  return (
    <BaseNode
      title={data.label ?? "Delay"}
      icon={icon}
      tileHue="var(--aw-status-warning)"
      status={status}
      selected={selected ?? false}
      nodeId={id}
      presetNodeType="delay"
      handleLeft={{ type: "target" }}
      handleRight={{ type: "source" }}
      collapsible={true}
      defaultExpanded={false}
      typeChip={typeChip}
      restLine={{ operation: "waits", argument: humanLabel }}
      activityLine={{ operation: "waiting", argument: humanLabel }}
      resultSummary={{ operation: "waited", argument: humanLabel }}
      metrics={[{ label: "duration", value: formatDuration(duration) }]}
      progress={status === "running" ? "indeterminate" : null}
      className="min-w-[180px]"
    >
      {({ isExpanded }) =>
        isExpanded ? (
          <div className="p-3">
            <div className="flex items-center gap-1.5">
              <input
                type="number"
                aria-label="Delay duration in milliseconds"
                className="nodrag flex-1 px-1.5 py-1 border border-border dark:border-border-dark rounded-node-ctl text-xs font-mono bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                value={duration}
                onChange={(e) => updateNodeData(parseInt(e.target.value) || 0)}
                min="0"
              />
              <span className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark">
                ms
              </span>
            </div>
          </div>
        ) : null
      }
    </BaseNode>
  );
};

export default memo(DelayNode);
