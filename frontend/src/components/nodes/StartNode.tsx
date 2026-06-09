import { memo } from 'react';
import { Play } from 'lucide-react';
import { BaseNode } from '../atoms/flow/BaseNode';
import type { StartNodeProps } from '../../types/StartNodeProps';

const StartNode = ({ id, selected }: StartNodeProps) => {
  return (
    <BaseNode
      title="Start"
      icon={<Play className="w-4 h-4 fill-current" style={{ color: 'var(--aw-status-success)' }} />}
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
            <div className="text-[9px]" style={{ color: 'var(--aw-text-muted)' }}>
              Entry point
            </div>
          )}
          {isExpanded && (
            <div
              className="text-[10px] leading-relaxed rounded p-2"
              style={{ backgroundColor: 'var(--aw-status-success)/5', color: 'var(--aw-text-secondary)' }}
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
