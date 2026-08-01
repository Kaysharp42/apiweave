import { memo } from "react";
import { Square } from "lucide-react";
import { BaseNode } from "../atoms/flow/BaseNode";
import type { EndNodeProps } from "../../types/EndNodeProps";

const EndNode = ({ id, selected }: EndNodeProps) => {
  return (
    <BaseNode
      title="End"
      icon={<Square className="w-3 h-3 fill-current" />}
      // Deliberately neutral rather than the old "End = red". A terminal node
      // is not a failed node, and red on this canvas means failure.
      tileHue="var(--aw-text-secondary)"
      status="idle"
      selected={selected ?? false}
      nodeId={id}
      handleLeft={{ type: "target" }}
      collapsible={true}
      defaultExpanded={false}
      restLine={{ operation: "final step" }}
      className="min-w-[160px]"
    >
      {({ isExpanded }) =>
        isExpanded ? (
          <div className="p-3">
            <div className="text-xs leading-relaxed rounded-node-ctl border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-2 text-text-secondary dark:text-text-secondary-dark">
              Final step of the workflow. Use it to mark completion after all
              required branches and assertions finish.
            </div>
          </div>
        ) : null
      }
    </BaseNode>
  );
};

export default memo(EndNode);
