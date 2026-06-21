import { memo } from "react";
import { Square } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import type { EndNodeProps } from "../../types/EndNodeProps";

const EndNode = ({ id, selected }: EndNodeProps) => {
  return (
    <BaseNode
      title="End"
      icon={
        <Square className="w-3.5 h-3.5 fill-current text-text-secondary dark:text-text-secondary-dark" />
      }
      status="idle"
      selected={selected ?? false}
      nodeId={id}
      handleLeft={{ type: "target" }}
      collapsible={true}
      defaultExpanded={false}
      className="min-w-[160px]"
    >
      {({ isExpanded }) => (
        <div className="p-3">
          {!isExpanded && (
            <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-text-muted dark:text-text-muted-dark">
              Final step
            </div>
          )}
          {isExpanded && (
            <div className="text-[10px] leading-relaxed rounded-sm border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-2 text-text-secondary dark:text-text-secondary-dark">
              Final step of the workflow. Use it to mark completion after all
              required branches and assertions finish.
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
};

export default memo(EndNode);
