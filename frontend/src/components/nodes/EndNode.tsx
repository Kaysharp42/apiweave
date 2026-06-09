import { memo } from 'react';
import { Square } from 'lucide-react';
import { BaseNode } from '../atoms/flow/BaseNode';
import type { EndNodeProps } from '../../types/EndNodeProps';

const EndNode = ({ id, selected }: EndNodeProps) => {
  return (
    <BaseNode
      title="End"
      icon={<Square className="w-3.5 h-3.5 fill-current" style={{ color: 'var(--aw-status-error)' }} />}
      status="idle"
      selected={selected ?? false}
      nodeId={id}
      handleLeft={{ type: 'target' }}
      collapsible={true}
      defaultExpanded={false}
      className="min-w-[160px]"
    >
      {({ isExpanded }) => (
        <div className="p-3">
          {!isExpanded && (
            <div className="text-[9px]" style={{ color: 'var(--aw-text-muted)' }}>
              Final step
            </div>
          )}
          {isExpanded && (
            <div
              className="text-[10px] leading-relaxed rounded p-2"
              style={{ backgroundColor: 'var(--aw-status-error)/5', color: 'var(--aw-text-secondary)' }}
            >
              Final step of the workflow. Use it to mark completion after all required branches and assertions finish.
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
};

export default memo(EndNode);
