import { memo } from "react";
import { Play } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import type { StartNodeProps } from "../../types/StartNodeProps";

const StartNode = ({ id, selected }: StartNodeProps) => {
  return (
    <BaseNode
      title="Start"
      icon={<Play className="w-3.5 h-3.5 fill-current" />}
      tileHue="var(--aw-status-success)"
      status="idle"
      selected={selected ?? false}
      nodeId={id}
      handleRight={{ type: "source" }}
      collapsible={true}
      defaultExpanded={false}
      restLine={{ operation: "entry point" }}
      className="min-w-[160px]"
    >
      {({ isExpanded }) =>
        isExpanded ? (
          <div className="p-3">
            <div className="text-xs leading-relaxed rounded-node-ctl border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-2 text-text-secondary dark:text-text-secondary-dark">
              Entry point for workflow execution. Connect this node to your
              first request or control step.
            </div>
          </div>
        ) : null
      }
    </BaseNode>
  );
};

export default memo(StartNode);
