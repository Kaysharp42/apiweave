import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Square } from 'lucide-react';

const EndNode = ({ data, selected }) => {
  return (
    <div
      className={[
        'px-5 py-2.5 rounded-full border-2 shadow-node transition-all cursor-pointer',
        'bg-gradient-to-r from-red-600 to-rose-500 dark:from-red-700 dark:to-rose-600',
        selected
          ? 'border-red-300 ring-2 ring-red-400/50 ring-offset-1 shadow-node-selected'
          : 'border-red-700 dark:border-red-800',
        'text-white',
      ].filter(Boolean).join(' ')}
    >
      <Handle
        type="target"
        position={Position.Left}
        className="!w-3 !h-3 !bg-white !border-2 !border-red-600 dark:!border-red-500 !rounded-sm"
      />
      <div className="flex items-center justify-center gap-2">
        <Square className="w-3.5 h-3.5 flex-shrink-0 fill-current" />
        <span className="text-xs font-bold tracking-wide">End</span>
      </div>
    </div>
  );
};

export default memo(EndNode);
