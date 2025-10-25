import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';

const StartNode = ({ data, selected }) => {
  return (
    <div
      className={`px-4 py-2 shadow-lg rounded-full border-2 ${
        selected ? 'bg-cyan-900 border-cyan-950 dark:bg-cyan-800 dark:border-cyan-900' : 'bg-gray-700 border-gray-900 dark:bg-gray-600 dark:border-gray-800'
      } text-white`}
      style={{ fontSize: '11px' }}
    >
      <div className="flex items-center justify-center gap-2">
        <svg className="w-3.5 h-3.5 flex-shrink-0 self-center" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
          <path d="M6.5 5.2a1 1 0 011.5-.87l6 3.8a1 1 0 010 1.74l-6 3.8A1 1 0 016.5 12.8V5.2z" />
        </svg>
        <div className="text-xs font-bold leading-none self-center">Start</div>
      </div>
      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />
    </div>
  );
};

export default memo(StartNode);
