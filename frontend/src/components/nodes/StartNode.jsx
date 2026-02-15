import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';
import { Play } from 'lucide-react';
import useCanvasStore from '../../stores/CanvasStore';
import NodeActionMenu from '../atoms/flow/NodeActionMenu';

const StartNode = ({ id, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);

  return (
    <div
      className={[
        'relative border-2 shadow-node transition-all cursor-pointer text-white',
        isExpanded ? 'rounded-2xl px-4 py-3 min-w-[220px]' : 'rounded-full px-5 py-2.5',
        'bg-gradient-to-r from-emerald-600 to-green-500 dark:from-emerald-700 dark:to-green-600',
        selected
          ? 'border-emerald-300 ring-2 ring-emerald-400/50 ring-offset-1 shadow-node-selected'
          : 'border-emerald-700 dark:border-emerald-800',
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

      <div className="flex items-center justify-center gap-2">
        <Play className="w-4 h-4 flex-shrink-0 fill-current" />
        <span className="text-xs font-bold tracking-wide">Start</span>
      </div>

      {isExpanded && (
        <div className="mt-2 rounded-lg bg-white/15 px-2 py-1.5 text-[10px] leading-relaxed text-emerald-50">
          Entry point for workflow execution. Connect this node to your first request or control step.
        </div>
      )}

      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-white !border-2 !border-emerald-600 dark:!border-emerald-500 !rounded-full"
      />
    </div>
  );
};

export default memo(StartNode);
