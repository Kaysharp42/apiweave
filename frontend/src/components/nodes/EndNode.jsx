import React, { memo } from 'react';
import { Handle, Position } from 'reactflow';

const EndNode = ({ data, selected }) => {
  return (
    <div
      className={`px-4 py-2 shadow-lg rounded-full border-2 ${
        selected ? 'bg-red-800 border-red-950 dark:bg-red-700 dark:border-red-900' : 'bg-red-700 border-red-900 dark:bg-red-600 dark:border-red-800'
      } text-white`}
      style={{ fontSize: '11px' }}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />
      <div className="flex items-center justify-center">
        <div className="text-xs font-bold">⏹️ End</div>
      </div>
    </div>
  );
};

export default memo(EndNode);
