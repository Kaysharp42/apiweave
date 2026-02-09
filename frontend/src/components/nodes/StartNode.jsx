import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';
import { Play } from 'lucide-react';

const StartNode = ({ data, selected }) => {
  return (
    <div
      className={`px-4 py-2 shadow-lg rounded-full border-2 ${
        selected ? 'bg-cyan-900 border-cyan-950 dark:bg-cyan-800 dark:border-cyan-900' : 'bg-gray-700 border-gray-900 dark:bg-gray-600 dark:border-gray-800'
      } text-white`}
      style={{ fontSize: '11px' }}
    >
      <div className="flex items-center justify-center gap-2">
        <Play className="w-3.5 h-3.5 flex-shrink-0 self-center" />
        <div className="text-xs font-bold leading-none self-center">Start</div>
      </div>
      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />
    </div>
  );
};

export default memo(StartNode);
