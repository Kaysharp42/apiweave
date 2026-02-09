import React, { memo, useState, useCallback, useMemo } from 'react';
import { Handle, Position } from 'reactflow';
import { useReactFlow } from 'reactflow';
import { useWorkflow } from '../../contexts/WorkflowContext';
import FileUploadSection from '../FileUploadSection';
import { Files, Copy, ChevronDown, ChevronUp, Snowflake, Trash2, Puzzle, Plus, CheckCircle, ArrowRight, AlertTriangle, XCircle } from 'lucide-react';

// Extractor form component
const ExtractorForm = ({ onAdd }) => {
  const [varName, setVarName] = useState('');
  const [varPath, setVarPath] = useState('response.body.');

  const handleAdd = () => {
    if (varName.trim() && varPath.trim()) {
      onAdd(varName.trim(), varPath.trim());
      setVarName('');
      setVarPath('response.body.');
    }
  };

  return (
    <div className="space-y-1 p-1.5 bg-gray-50 dark:bg-gray-900/50 rounded border border-dashed border-gray-300 dark:border-gray-600">
      <div>
        <input
          type="text"
          placeholder="Variable name (e.g., token)"
          className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-cyan-500"
          value={varName}
          onChange={(e) => setVarName(e.target.value)}
        />
      </div>
      <div>
        <input
          type="text"
          placeholder="Path (e.g., response.body.token or response.cookies.sessionId)"
          className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500"
          value={varPath}
          onChange={(e) => setVarPath(e.target.value)}
        />
      </div>
      <button
        onClick={handleAdd}
        className="w-full px-2 py-1 bg-green-500 dark:bg-green-600 hover:bg-green-600 dark:hover:bg-green-700 text-white text-[9px] font-semibold rounded nodrag transition-colors flex items-center justify-center gap-1"
      >
        <Plus className="w-3 h-3" />
        <span>Add Extractor</span>
      </button>
    </div>
  );
};

const HTTPRequestNode = ({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isResponseExpanded, setIsResponseExpanded] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const { setNodes } = useReactFlow();
  const { variables } = useWorkflow(); // Get all workflow variables

  // Memoize the stringified response to avoid re-stringifying on every render
  const responseBodyString = useMemo(() => {
    if (!data.executionResult?.body) return '';
    return typeof data.executionResult.body === 'string' 
      ? data.executionResult.body 
      : JSON.stringify(data.executionResult.body, null, 2);
  }, [data.executionResult?.body]);

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
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">{data.label || 'HTTP Request'}</h3>
            {data.executionStatus && (
              <span className={`text-xs px-1.5 py-0.5 rounded ${getStatusBadgeStyle()}`}>
                {data.executionStatus}
              </span>
            )}
            {/* Branch count badge */}
            {data.branchCount > 1 && (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-200 font-semibold flex items-center gap-1" title={`${data.branchCount} parallel branches`}>
                <Snowflake className="w-3 h-3" />
                <span>{data.branchCount}x</span>
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {/* Three-dot menu */}
            <div className="relative">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setShowMenu(!showMenu);
                }}
                className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 nodrag focus:outline-none focus:ring-0 active:bg-transparent select-none bg-transparent hover:bg-transparent"
                style={{ background: 'transparent', border: 'none', padding: '0 4px', WebkitTapHighlightColor: 'transparent' }}
                title="More options"
              >
                ⋯
              </button>
              
              {/* Dropdown menu */}
              {showMenu && (
                <div className="absolute right-0 mt-1 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded shadow-lg z-50 nodrag min-w-[130px]">
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new CustomEvent('duplicateNode', { detail: { nodeId: id } }));
                      setShowMenu(false);
                    }}
                    className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none flex items-center gap-2"
                  >
                    <Files className="w-4 h-4" />
                    <span>Duplicate</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      window.dispatchEvent(new CustomEvent('copyNode', { detail: { nodeId: id } }));
                      setShowMenu(false);
                    }}
                    className="block w-full text-left px-3 py-1.5 text-xs text-gray-700 dark:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-600 focus:outline-none border-t border-gray-300 dark:border-gray-600 flex items-center gap-2"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Copy</span>
                  </button>
                </div>
              )}
            </div>
            
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 nodrag focus:outline-none focus:ring-0 active:bg-transparent select-none bg-transparent hover:bg-transparent"
              style={{ background: 'transparent', border: 'none', padding: '0', WebkitTapHighlightColor: 'transparent' }}
              aria-expanded={isExpanded}
              title={isExpanded ? 'Collapse' : 'Expand'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          </div>
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

            {/* Store Result As (Extract Variables) */}
            <div className="border-t dark:border-gray-700 pt-2 mt-2">
              <label className="block text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5 flex items-center gap-1">
                <Puzzle className="w-4 h-4" />
                <span>Store Response Fields As Variables</span>
                <span className="text-gray-500 dark:text-gray-500 font-normal text-[9px] block mt-0.5 ml-auto">
                  Extract values from response and save as workflow variables
                </span>
              </label>
              
              {/* Extractors List */}
              <div className="space-y-1 mb-2">
                {(data.config?.extractors && Object.entries(data.config.extractors).length > 0) ? (
                  Object.entries(data.config.extractors).map(([varName, varPath]) => (
                    <div key={varName} className="flex gap-1 items-center text-[9px]">
                      <code className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded flex-1">
                        {varName}
                      </code>
                      <span className="text-gray-500 dark:text-gray-400">←</span>
                      <code className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded flex-1 truncate">
                        {varPath}
                      </code>
                      <button
                        className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 nodrag flex-shrink-0"
                        onClick={() => {
                          const newExtractors = { ...data.config.extractors };
                          delete newExtractors[varName];
                          updateNodeData('extractors', newExtractors);
                          
                          // Emit event to notify WorkflowCanvas of deleted extractor
                          window.dispatchEvent(new CustomEvent('extractorDeleted', {
                            detail: {
                              varName: varName,
                              nodeId: id
                            }
                          }));
                        }}
                        title="Delete extractor"
                      >
                        <Trash2 className="w-3 h-3" />
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="text-[9px] text-gray-500 dark:text-gray-400 italic">No extractors configured</div>
                )}
              </div>

              {/* Add Extractor Form */}
              <ExtractorForm onAdd={(varName, varPath) => {
                const newExtractors = data.config?.extractors || {};
                newExtractors[varName] = varPath;
                updateNodeData('extractors', newExtractors);
              }} />
            </div>

            {/* File Upload Section */}
            <FileUploadSection
              fileUploads={data.config?.fileUploads || []}
              onUpdate={(files) => updateNodeData('fileUploads', files)}
              variables={variables}
            />

            {/* Variable Hint */}
            <div className="text-[9px] text-gray-500 dark:text-gray-400 p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded space-y-0.5">
              <div><strong>💡 Variable Reference:</strong></div>
              <div className="pl-2">
                <div><strong className="text-blue-700 dark:text-blue-300">From Previous Node:</strong></div>
                <div className="pl-2">
                  <div>• Body: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{`{{prev.response.body.token}}`}</code></div>
                  <div>• Array: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{`{{prev.response.body.data[0].city}}`}</code></div>
                  <div>• Header: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{`{{prev.response.headers.content-type}}`}</code></div>
                  <div>• Cookie: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded">{`{{prev.response.cookies.session}}`}</code></div>
                </div>
                <div className="mt-1"><strong className="text-green-700 dark:text-green-300">From Workflow Variables:</strong></div>
                {variables && Object.keys(variables).length > 0 ? (
                  <div className="pl-2 space-y-0.5">
                    {Object.keys(variables).map(varName => (
                      <div key={varName}>
                        • <code className="bg-gray-200 dark:bg-gray-600 px-1 rounded">{`{{variables.${varName}}}`}</code>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="pl-2 text-gray-400 italic">No workflow variables yet</div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Execution Result */}
        {data.executionResult && (
          <div className="mt-2 pt-2 border-t dark:border-gray-700">
            <div className="text-[10px] font-semibold text-gray-700 dark:text-gray-300 mb-1">Response</div>
            {data.executionResult.statusCode && (
              <div className="text-[10px] text-gray-600 dark:text-gray-400 flex items-center gap-2 flex-wrap">
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
                <span className="text-[9px] flex items-center gap-1">
                  {data.executionResult.statusCode >= 200 && data.executionResult.statusCode < 300 
                    ? <>
                        <CheckCircle className="w-3 h-3" />
                        Success
                      </>
                    : data.executionResult.statusCode >= 300 && data.executionResult.statusCode < 400
                    ? <>
                        <ArrowRight className="w-3 h-3" />
                        Redirect
                      </>
                    : data.executionResult.statusCode >= 400 && data.executionResult.statusCode < 500
                    ? <>
                        <AlertTriangle className="w-3 h-3" />
                        Client Error
                      </>
                    : <>
                        <XCircle className="w-3 h-3" />
                        Server Error
                      </>
                  }
                </span>
                {data.executionResult.duration !== undefined && (
                  <>
                    <span>•</span>
                    <span className="font-semibold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                      ⏱ {data.executionResult.duration >= 1000 
                        ? `${(data.executionResult.duration / 1000).toFixed(2)}s` 
                        : `${data.executionResult.duration}ms`}
                    </span>
                  </>
                )}
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
              <div className={`mt-1 ${data.executionStatus === 'error' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded' : ''}`}>
                <div className={`text-[10px] font-semibold mb-0.5 flex items-center justify-between ${data.executionStatus === 'error' ? 'text-red-700 dark:text-red-300' : 'text-gray-700 dark:text-gray-300'}`}>
                  <span>Body{data.executionStatus === 'error' ? ' (Error Response)' : ''}</span>
                  <button
                    onClick={() => setIsResponseExpanded(!isResponseExpanded)}
                    className="p-0.5 hover:bg-gray-300 dark:hover:bg-gray-600 rounded transition-colors"
                    title={isResponseExpanded ? 'Collapse' : 'Expand'}
                  >
                    {isResponseExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
                  </button>
                </div>
                <textarea
                  className={`w-full px-1.5 py-1 border text-[10px] font-mono nodrag overflow-y-auto ${data.executionStatus === 'error' ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200' : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'}`}
                  style={{ 
                    height: isResponseExpanded ? '600px' : '150px',
                    resize: 'vertical',
                    minHeight: '100px'
                  }}
                  value={responseBodyString}
                  readOnly
                  onFocus={(e) => e.target.select()}
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

export default HTTPRequestNode;
