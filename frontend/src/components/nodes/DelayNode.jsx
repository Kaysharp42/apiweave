import React, { memo, useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { useReactFlow } from 'reactflow';
import { Clock, Timer, Copy } from 'lucide-react';

const DelayNode = ({ id, data, selected }) => {
  const { setNodes } = useReactFlow();

  const updateNodeData = useCallback((value) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              config: {
                ...node.data.config,
                duration: value,
              },
            },
          };
        }
        return node;
      })
    );
  }, [id, setNodes]);

  return (
    <div
      className={`rounded-md bg-white dark:bg-gray-800 border-2 shadow-lg min-w-[150px] ${
        selected ? 'border-cyan-600 dark:border-cyan-500' : 'border-slate-300 dark:border-gray-600'
      }`}
      style={{ fontSize: '12px' }}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />

      {/* Header */}
      <div className="px-2 py-1.5 border-b-2 border-slate-300 dark:border-gray-700 bg-yellow-50 dark:bg-yellow-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-yellow-700 dark:text-yellow-300" />
            <h3 className="text-sm font-semibold text-yellow-800 dark:text-yellow-200">{data.label || 'Delay'}</h3>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent('duplicateNode', { detail: { nodeId: id } })
                );
              }}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 nodrag focus:outline-none focus:ring-0 active:bg-transparent select-none bg-transparent hover:bg-transparent"
              style={{ background: 'transparent', border: 'none', padding: 0, boxShadow: 'none', outline: 'none', WebkitTapHighlightColor: 'transparent' }}
              title="Duplicate node"
            >
              <Copy className="w-4 h-4" />
            </button>
            <button
              onClick={(e) => {
                e.stopPropagation();
                window.dispatchEvent(
                  new CustomEvent('copyNode', { detail: { nodeId: id } })
                );
              }}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 nodrag focus:outline-none focus:ring-0 active:bg-transparent select-none bg-transparent hover:bg-transparent"
              style={{ background: 'transparent', border: 'none', padding: 0, boxShadow: 'none', outline: 'none', WebkitTapHighlightColor: 'transparent' }}
              title="Copy node"
            >
              <Timer className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-2 space-y-1">
        <div className="text-[10px] text-gray-600 dark:text-gray-400">Wait before next step</div>
        <div className="flex items-center gap-1">
          <input
            type="number"
            className="nodrag flex-1 px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
            value={data.config?.duration || 1000}
            onChange={(e) => updateNodeData(parseInt(e.target.value))}
            min="0"
          />
          <span className="text-[10px] text-gray-600 dark:text-gray-400">ms</span>
        </div>
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />
    </div>
  );
};

export default memo(DelayNode);
