import React, { memo, useState, useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { useReactFlow } from 'reactflow';

const HTTPRequestNode = ({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { setNodes } = useReactFlow();

  const updateNodeData = useCallback((field, value) => {
    setNodes((nds) =>
      nds.map((node) => {
        if (node.id === id) {
          return {
            ...node,
            data: {
              ...node.data,
              config: {
                ...node.data.config,
                [field]: value,
              },
            },
          };
        }
        return node;
      })
    );
  }, [id, setNodes]);

  // Get execution status styling
  const getStatusBorder = () => {
    if (data.executionStatus === 'running') return 'border-yellow-500 dark:border-yellow-400 animate-pulse';
    if (data.executionStatus === 'success') return 'border-green-500 dark:border-green-400';
    if (data.executionStatus === 'warning') return 'border-orange-500 dark:border-orange-400';
    if (data.executionStatus === 'error') return 'border-red-500 dark:border-red-400';
    return selected ? 'border-cyan-600 dark:border-cyan-500' : 'border-slate-300 dark:border-gray-600';
  };

  const getStatusBadgeStyle = () => {
    if (data.executionStatus === 'running') return 'bg-yellow-200 dark:bg-yellow-900 text-yellow-800 dark:text-yellow-200';
    if (data.executionStatus === 'success') return 'bg-green-200 dark:bg-green-900 text-green-800 dark:text-green-200';
    if (data.executionStatus === 'warning') return 'bg-orange-200 dark:bg-orange-900 text-orange-800 dark:text-orange-200';
    if (data.executionStatus === 'error') return 'bg-red-200 dark:bg-red-900 text-red-800 dark:text-red-200';
    return '';
  };

  return (
    <div
      className={`rounded-md bg-white dark:bg-gray-800 border-2 shadow-lg min-w-[200px] ${getStatusBorder()}`}
      style={{ fontSize: '12px' }}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />

      {/* Header */}
      <div className="px-2 py-1.5 border-b-2 border-slate-300 dark:border-gray-700 bg-slate-50 dark:bg-gray-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">HTTP Request</h3>
            {data.executionStatus && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusBadgeStyle()}`}>
                {data.executionStatus}
              </span>
            )}
          </div>
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
        {/* Method & URL */}
        <div className="flex gap-1">
          <select
            className="nodrag px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-cyan-500"
            value={data.config?.method || 'GET'}
            onChange={(e) => updateNodeData('method', e.target.value)}
          >
            <option value="GET">GET</option>
            <option value="POST">POST</option>
            <option value="PUT">PUT</option>
            <option value="DELETE">DELETE</option>
            <option value="PATCH">PATCH</option>
          </select>
          <input
            type="text"
            placeholder="Enter URL..."
            className="nodrag flex-1 px-2 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
            value={data.config?.url || ''}
            onChange={(e) => updateNodeData('url', e.target.value)}
          />
        </div>

        {/* Expanded Details */}
        {isExpanded && (
          <div className="space-y-1.5 pt-1 border-t dark:border-gray-700">
            {/* Query Parameters */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
                Query Params <span className="text-gray-500 dark:text-gray-500 font-normal">(key=value, one per line)</span>
              </label>
              <textarea
                className="nodrag w-full px-1.5 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
                rows={2}
                placeholder={'page=1\nlimit=10\nsearch={{prev.query}}'}
                value={data.config?.queryParams || ''}
                onChange={(e) => updateNodeData('queryParams', e.target.value)}
              />
            </div>

            {/* Path Variables */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
                Path Variables <span className="text-gray-500 dark:text-gray-500 font-normal">(Use :varName in URL)</span>
              </label>
              <textarea
                className="nodrag w-full px-1.5 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
                rows={2}
                placeholder={'userId={{prev.response.body.id}}\nteamId=123'}
                value={data.config?.pathVariables || ''}
                onChange={(e) => updateNodeData('pathVariables', e.target.value)}
              />
            </div>

            {/* Headers */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
                Headers <span className="text-gray-500 dark:text-gray-500 font-normal">(key=value)</span>
              </label>
              <textarea
                className="nodrag w-full px-1.5 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
                rows={2}
                placeholder={'Content-Type=application/json\nAuthorization=Bearer {{prev.response.body.token}}'}
                value={data.config?.headers || ''}
                onChange={(e) => updateNodeData('headers', e.target.value)}
              />
            </div>

            {/* Cookies */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
                Cookies <span className="text-gray-500 dark:text-gray-500 font-normal">(key=value)</span>
              </label>
              <textarea
                className="nodrag w-full px-1.5 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
                rows={2}
                placeholder={'session={{prev.response.cookies.session}}\nuser_id=123'}
                value={data.config?.cookies || ''}
                onChange={(e) => updateNodeData('cookies', e.target.value)}
              />
            </div>

            {/* Body */}
            {data.config?.method !== 'GET' && (
              <div>
                <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Body</label>
                <textarea
                  className="nodrag w-full px-1.5 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
                  rows={3}
                  placeholder={'{\n  "username": "{{prev.response.body.username}}",\n  "token": "{{prev.response.body.token}}"\n}'}
                  value={data.config?.body || ''}
                  onChange={(e) => updateNodeData('body', e.target.value)}
                />
              </div>
            )}

            {/* Timeout */}
            <div>
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
                Timeout (seconds)
              </label>
              <input
                type="number"
                className="nodrag w-16 px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-xs focus:outline-none focus:ring-2 focus:ring-cyan-500"
                value={data.config?.timeout || 30}
                onChange={(e) => updateNodeData('timeout', parseInt(e.target.value))}
                min="1"
              />
            </div>

            {/* Variable Hint */}
            <div className="text-[9px] text-gray-500 dark:text-gray-400 p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded space-y-0.5">
              <div><strong>💡 Access previous node data:</strong></div>
              <div className="pl-2">
                <div>• Body: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{`{{prev.response.body.token}}`}</code></div>
                <div>• Array: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{`{{prev.response.body.data[0].city}}`}</code></div>
                <div>• Header: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{`{{prev.response.headers.content-type}}`}</code></div>
                <div>• Cookie: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{`{{prev.response.cookies.session}}`}</code></div>
              </div>
            </div>
          </div>
        )}

        {/* Execution Result */}
        {data.executionResult && (
          <div className="mt-2 pt-2 border-t dark:border-gray-700">
            <div className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Response</div>
            {data.executionResult.statusCode && (
              <div className="text-[10px] text-gray-600 dark:text-gray-400 flex items-center gap-2">
                <span>Status:</span>
                <span className={`font-semibold px-1.5 py-0.5 rounded ${
                  data.executionResult.statusCode >= 200 && data.executionResult.statusCode < 300 
                    ? 'bg-green-100 dark:bg-green-900 text-green-700 dark:text-green-300' 
                    : data.executionResult.statusCode >= 300 && data.executionResult.statusCode < 400
                    ? 'bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300'
                    : data.executionResult.statusCode >= 400 && data.executionResult.statusCode < 500
                    ? 'bg-orange-100 dark:bg-orange-900 text-orange-700 dark:text-orange-300'
                    : 'bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300'
                }`}>
                  {data.executionResult.statusCode}
                </span>
                <span className="text-[9px]">
                  {data.executionResult.statusCode >= 200 && data.executionResult.statusCode < 300 
                    ? '✓ Success' 
                    : data.executionResult.statusCode >= 300 && data.executionResult.statusCode < 400
                    ? '↪ Redirect'
                    : data.executionResult.statusCode >= 400 && data.executionResult.statusCode < 500
                    ? '⚠ Client Error'
                    : '✗ Server Error'}
                </span>
              </div>
            )}
            {data.executionResult.cookies && Object.keys(data.executionResult.cookies).length > 0 && (
              <div className="mt-1 text-[10px] text-gray-600 dark:text-gray-400">
                <span className="font-semibold">Cookies:</span>
                <div className="pl-2 text-[9px] space-y-0.5 mt-0.5">
                  {Object.entries(data.executionResult.cookies).map(([key, value]) => (
                    <div key={key}>
                      <code className="bg-gray-100 dark:bg-gray-700 px-1 rounded">{key}</code>: {value}
                    </div>
                  ))}
                </div>
              </div>
            )}
            {data.executionResult.body && (
              <div className="mt-1">
                <div className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">Body</div>
                <textarea
                  className="w-full px-1.5 py-1 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-[10px] font-mono"
                  rows={4}
                  value={typeof data.executionResult.body === 'string' 
                    ? data.executionResult.body 
                    : JSON.stringify(data.executionResult.body, null, 2)}
                  readOnly
                />
              </div>
            )}
            {data.executionResult.error && (
              <div className="text-[10px] text-red-600 dark:text-red-400 mt-1 p-1.5 bg-red-50 dark:bg-red-900/20 rounded">
                <span className="font-semibold">Error:</span> {data.executionResult.error}
              </div>
            )}
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />
    </div>
  );
};

export default memo(HTTPRequestNode);
