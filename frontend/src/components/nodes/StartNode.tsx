import { memo } from 'react';
import { Play } from 'lucide-react';
import { BaseNode } from '../atoms/flow/BaseNode';
import type { StartNodeProps } from '../../types/StartNodeProps';

const StartNode = ({ id, selected }: StartNodeProps) => {
  return (
    <BaseNode
      title="Start"
      icon={<Play className="w-4 h-4 fill-current text-text-secondary dark:text-text-secondary-dark" />}
      status="idle"
      selected={selected ?? false}
      nodeId={id}
      handleRight={{ type: 'source' }}
      collapsible={true}
      defaultExpanded={false}
      className="min-w-[160px]"
    >
      {({ isExpanded }) => (
        <div className="p-3">
          {!isExpanded && (
            <div className="text-[9px] font-mono uppercase tracking-[0.12em] text-text-muted dark:text-text-muted-dark">
              Entry point
            </div>
          )}
          {isExpanded && (
            <div
              className="text-[10px] leading-relaxed rounded-sm border border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay p-2 text-text-secondary dark:text-text-secondary-dark"
            >
              Entry point for workflow execution. Connect this node to your first request or control step.
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
};

export default memo(StartNode);
