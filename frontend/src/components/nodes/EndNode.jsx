import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Square } from 'lucide-react';
import useCanvasStore from '../../stores/CanvasStore';
import NodeActionMenu from '../atoms/flow/NodeActionMenu';

const EndNode = ({ id, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={[
        'relative border-2 shadow-node transition-all cursor-pointer text-white',
        isExpanded ? 'rounded-2xl px-4 py-3 min-w-[220px]' : 'rounded-full px-5 py-2.5',
        'bg-gradient-to-r from-red-600 to-rose-500 dark:from-red-700 dark:to-rose-600',
        selected
          ? 'border-red-300 ring-2 ring-red-400/50 shadow-node-selected'
          : 'border-red-700 dark:border-red-800',
      ].filter(Boolean).join(' ')}
    >
      <div className="absolute -top-1 -right-1">
        <NodeActionMenu
          nodeId={id}
          collapsible
          isExpanded={isExpanded}
          onDuplicate={() => useCanvasStore.getState().duplicateNode(id)}
          onCopy={() => useCanvasStore.getState().copyNode(id)}
          onToggleExpand={setIsExpanded}
          triggerClassName="text-white/90 hover:text-white hover:bg-white/20"
        />
      </div>

      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-white !border-2 !border-red-600 dark:!border-red-500 !rounded-full"
      />
      <div className="flex items-center justify-center gap-2">
        <Square className="w-3.5 h-3.5 flex-shrink-0 fill-current" />
        <span className="text-xs font-bold tracking-wide">End</span>
      </div>

      {isExpanded && (
        <div className="mt-2 rounded-lg bg-white/15 px-2 py-1.5 text-[10px] leading-relaxed text-rose-50">
          Final step of the workflow. Use it to mark completion after all required branches and assertions finish.
        </div>
      )}
    </div>
  );
};

export default memo(EndNode);
