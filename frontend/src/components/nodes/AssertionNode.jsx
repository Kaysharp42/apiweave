import React, { memo, useState } from 'react';
import { Handle, Position } from 'reactflow';

const AssertionNode = ({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [jsonPath, setJsonPath] = useState('');
  const [operator, setOperator] = useState('equals');
  const [expectedValue, setExpectedValue] = useState('');

  return (
    <div
      className={`rounded-md bg-white dark:bg-gray-800 border-2 shadow-lg min-w-[200px] ${
        selected ? 'border-cyan-600 dark:border-cyan-500' : 'border-slate-300 dark:border-gray-600'
      }`}
      style={{ fontSize: '12px' }}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />

      {/* Header */}
      <div className="px-2 py-1.5 border-b-2 border-slate-300 dark:border-gray-700 bg-green-50 dark:bg-green-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-green-800 dark:text-green-200">✓ Assertion</h3>
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 nodrag"
          >
            {isExpanded ? '▼' : '▶'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="p-2 space-y-1.5">
        <div className="text-[10px] text-gray-600 dark:text-gray-400">Assert on response data</div>

        {isExpanded && (
          <div className="space-y-1.5 pt-1 border-t dark:border-gray-700">
            <div>
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
                JSONPath Expression
              </label>
              <input
                type="text"
                placeholder="$.status"
                className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
                value={jsonPath}
                onChange={(e) => setJsonPath(e.target.value)}
              />
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Operator</label>
              <select 
                className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-[10px] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                value={operator}
                onChange={(e) => setOperator(e.target.value)}
              >
                <option value="equals">Equals</option>
                <option value="notEquals">Not Equals</option>
                <option value="contains">Contains</option>
                <option value="gt">Greater Than</option>
                <option value="lt">Less Than</option>
                <option value="exists">Exists</option>
              </select>
            </div>

            <div>
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
                Expected Value
              </label>
              <input
                type="text"
                placeholder="200"
                className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[10px] focus:outline-none focus:ring-2 focus:ring-cyan-500"
                value={expectedValue}
                onChange={(e) => setExpectedValue(e.target.value)}
              />
            </div>

            <button className="nodrag w-full px-2 py-0.5 bg-green-600 dark:bg-green-700 text-white text-[10px] rounded hover:bg-green-700 dark:hover:bg-green-800">
              + Add Assertion
            </button>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />
    </div>
  );
};

export default memo(AssertionNode);
