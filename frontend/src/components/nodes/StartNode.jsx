import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Play } from 'lucide-react';

const StartNode = ({ data, selected }) => {
  return (
    <div
      className={[
        'px-5 py-2.5 rounded-full border-2 shadow-node transition-all cursor-pointer',
        'bg-gradient-to-r from-emerald-600 to-green-500 dark:from-emerald-700 dark:to-green-600',
        selected
          ? 'border-emerald-300 ring-2 ring-emerald-400/50 ring-offset-1 shadow-node-selected'
          : 'border-emerald-700 dark:border-emerald-800',
        'text-white',
      ].filter(Boolean).join(' ')}
    >
      <div className="flex items-center justify-center gap-2">
        <Play className="w-4 h-4 flex-shrink-0 fill-current" />
        <span className="text-xs font-bold tracking-wide">Start</span>
      </div>
      <Handle
        type="source"
        position={Position.Right}
        className="!w-3 !h-3 !bg-white !border-2 !border-emerald-600 dark:!border-emerald-500 !rounded-sm"
      />
    </div>
  );
};

export default memo(StartNode);
