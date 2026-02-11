import React, { memo, useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import { useWorkflow } from '../../contexts/WorkflowContext';
import BaseNode from '../atoms/flow/BaseNode';
import FileUploadSection from '../FileUploadSection';
import { Puzzle, Plus, Trash2, CheckCircle, ArrowRight, AlertTriangle, XCircle, ChevronDown, ChevronUp, Snowflake, ExternalLink, Clock3 } from 'lucide-react';

// — Method badge color map (design tokens) —
const methodColors = {
  GET:    'bg-method-get text-white',
  POST:   'bg-method-post text-white',
  PUT:    'bg-method-put text-white',
  DELETE: 'bg-method-delete text-white',
  PATCH:  'bg-method-patch text-white',
};

const formatRefreshTime = (isoValue) => {
  if (!isoValue) return 'Unavailable';
  const parsedDate = new Date(isoValue);
  if (Number.isNaN(parsedDate.getTime())) {
    return isoValue;
  }
  return parsedDate.toLocaleString();
};

const SchemaWarningBadge = ({ warning }) => {
  const [isOpen, setIsOpen] = useState(false);
  const wrapperRef = useRef(null);
  const triggerRef = useRef(null);

  useEffect(() => {
    if (!isOpen) return undefined;

    const handleClickOutside = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setIsOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  const handleBlur = useCallback((event) => {
    const nextFocusedElement = event.relatedTarget;
    if (!nextFocusedElement) return;
    if (wrapperRef.current && !wrapperRef.current.contains(nextFocusedElement)) {
      setIsOpen(false);
    }
  }, []);

  const refreshedLabel = useMemo(() => formatRefreshTime(warning?.refreshedAt), [warning?.refreshedAt]);

  if (!warning) return null;

  return (
    <div
      ref={wrapperRef}
      className="relative flex-shrink-0"
      onMouseEnter={() => setIsOpen(true)}
      onMouseLeave={() => setIsOpen(false)}
      onFocus={() => setIsOpen(true)}
      onBlur={handleBlur}
    >
      <button
        ref={triggerRef}
        type="button"
        className="nodrag text-[9px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 dark:bg-amber-900/60 dark:text-amber-200 font-semibold flex items-center gap-0.5 hover:bg-amber-200 dark:hover:bg-amber-900/80 focus:outline-none focus:ring-1 focus:ring-amber-400"
        title={warning.text || 'Swagger docs changed. Verify this request.'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label="Show Swagger warning details"
        onClick={(event) => {
          event.stopPropagation();
          setIsOpen((previousState) => !previousState);
        }}
      >
        <AlertTriangle className="w-3 h-3" />
        Check API
      </button>

      {isOpen && (
        <div
          role="dialog"
          aria-label="Swagger warning details"
          className="nodrag absolute top-full right-0 mt-1 z-[120] w-[260px] max-w-[calc(100vw-2rem)] rounded-md border border-amber-300/70 dark:border-amber-700/70 bg-surface-raised dark:bg-surface-dark-raised p-2 shadow-2xl"
          onClick={(event) => event.stopPropagation()}
        >
          <div className="text-[10px] font-semibold text-amber-700 dark:text-amber-300 mb-1">Swagger Warning</div>
          <p className="text-[10px] text-text-primary dark:text-text-primary-dark leading-snug break-words">{warning.text}</p>

          <div className="mt-2 pt-2 border-t border-border dark:border-border-dark space-y-1 text-[9px] text-text-secondary dark:text-text-secondary-dark">
            <div className="flex items-center gap-1">
              <Clock3 className="w-3 h-3" />
              <span className="font-semibold">Refreshed:</span>
            </div>
            <div className="pl-4 text-text-primary dark:text-text-primary-dark">{refreshedLabel}</div>

            <div className="flex items-center gap-1 pt-1">
              <ExternalLink className="w-3 h-3" />
              <span className="font-semibold">Source:</span>
            </div>

            {warning.sourceUrl ? (
              <a
                href={warning.sourceUrl}
                target="_blank"
                rel="noreferrer"
                className="pl-4 block text-primary dark:text-primary-dark underline hover:text-primary/80 dark:hover:text-primary-dark/80 break-all"
                title={warning.sourceUrl}
              >
                {warning.sourceUrl}
              </a>
            ) : (
              <div className="pl-4 text-text-muted dark:text-text-muted-dark">Unavailable</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

// — Extractor form sub-component —
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
    <div className="space-y-1 p-1.5 bg-surface-overlay dark:bg-surface-dark-overlay rounded border border-dashed border-border dark:border-border-dark">
      <input
        type="text"
        placeholder="Variable name (e.g., token)"
        className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-primary"
        value={varName}
        onChange={(e) => setVarName(e.target.value)}
      />
      <input
        type="text"
        placeholder="Path (e.g., response.body.token)"
        className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[9px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
        value={varPath}
        onChange={(e) => setVarPath(e.target.value)}
      />
      <button
        onClick={handleAdd}
        className="w-full px-2 py-1 bg-status-success hover:bg-green-700 text-white text-[9px] font-semibold rounded nodrag transition-colors flex items-center justify-center gap-1"
      >
        <Plus className="w-3 h-3" />
        <span>Add Extractor</span>
      </button>
    </div>
  );
};

// — Inline response preview (compact) —
const ResponsePreview = ({ result, status }) => {
  const [isBodyExpanded, setIsBodyExpanded] = useState(false);

  const bodyStr = useMemo(() => {
    if (!result?.body) return '';
    return typeof result.body === 'string' ? result.body : JSON.stringify(result.body, null, 2);
  }, [result?.body]);

  if (!result) return null;

  const codeClass = (() => {
    const c = result.statusCode;
    if (c >= 200 && c < 300) return 'bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300';
    if (c >= 300 && c < 400) return 'bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300';
    if (c >= 400 && c < 500) return 'bg-orange-100 dark:bg-orange-900/40 text-orange-700 dark:text-orange-300';
    return 'bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300';
  })();

  const statusLabel = (() => {
    const c = result.statusCode;
    if (c >= 200 && c < 300) return <><CheckCircle className="w-3 h-3" /> Success</>;
    if (c >= 300 && c < 400) return <><ArrowRight className="w-3 h-3" /> Redirect</>;
    if (c >= 400 && c < 500) return <><AlertTriangle className="w-3 h-3" /> Client Error</>;
    return <><XCircle className="w-3 h-3" /> Server Error</>;
  })();

  return (
    <div className="mt-2 pt-2 border-t border-border dark:border-border-dark">
      <div className="text-[10px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-1">Response</div>

      {result.statusCode && (
        <div className="flex items-center gap-2 flex-wrap text-[10px]">
          <span className={`font-semibold px-1.5 py-0.5 rounded ${codeClass}`}>{result.statusCode}</span>
          <span className="flex items-center gap-1 text-text-secondary dark:text-text-secondary-dark">{statusLabel}</span>
          {result.duration !== undefined && (
            <>
              <span className="text-text-muted dark:text-text-muted-dark">•</span>
              <span className="font-semibold px-1.5 py-0.5 rounded bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-300">
                ⏱ {result.duration >= 1000 ? `${(result.duration / 1000).toFixed(2)}s` : `${result.duration}ms`}
              </span>
            </>
          )}
        </div>
      )}

      {/* Cookies */}
      {result.cookies && Object.keys(result.cookies).length > 0 && (
        <div className="mt-1 text-[10px] text-text-secondary dark:text-text-secondary-dark">
          <span className="font-semibold">Cookies:</span>
          <div className="pl-2 text-[9px] space-y-0.5 mt-0.5">
            {Object.entries(result.cookies).map(([key, value]) => (
              <div key={key}><code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{key}</code>: {value}</div>
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      {result.body && (
        <div className={`mt-1 ${status === 'error' ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-700 rounded' : ''}`}>
          <div className={`text-[10px] font-semibold mb-0.5 flex items-center justify-between ${status === 'error' ? 'text-red-700 dark:text-red-300' : 'text-text-secondary dark:text-text-secondary-dark'}`}>
            <span>Body{status === 'error' ? ' (Error)' : ''}</span>
            <button
              onClick={() => setIsBodyExpanded(!isBodyExpanded)}
              className="p-0.5 hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay rounded transition-colors nodrag"
              title={isBodyExpanded ? 'Collapse' : 'Expand'}
            >
              {isBodyExpanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
            </button>
          </div>
          <textarea
            className={`w-full px-1.5 py-1 border text-[10px] font-mono nodrag rounded overflow-y-auto ${status === 'error' ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900/30 text-red-800 dark:text-red-200' : 'border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark'}`}
            style={{ height: isBodyExpanded ? '600px' : '150px', resize: 'vertical', minHeight: '100px' }}
            value={bodyStr}
            readOnly
            onFocus={(e) => e.target.select()}
          />
        </div>
      )}

      {result.error && (
        <div className="text-[10px] text-red-600 dark:text-red-400 mt-1 p-1.5 bg-red-50 dark:bg-red-900/20 rounded">
          <span className="font-semibold">Error:</span> {result.error}
        </div>
      )}
    </div>
  );
};

// — Main HTTP Request Node —
const HTTPRequestNode = ({ id, data, selected }) => {
  const { setNodes } = useReactFlow();
  const { variables } = useWorkflow();

  const updateNodeData = useCallback((field, value) => {
    setNodes((nds) =>
      nds.map((node) =>
        node.id === id
          ? { ...node, data: { ...node.data, config: { ...node.data.config, [field]: value } } }
          : node
      )
    );
  }, [id, setNodes]);

  const method = data.config?.method || 'GET';
  const methodBadge = methodColors[method] || methodColors.GET;

  // Count summary for collapsed state
  const headerCount = (data.config?.headers || '').split('\n').filter(Boolean).length;
  const extractorCount = data.config?.extractors ? Object.keys(data.config.extractors).length : 0;
  const hasBody = data.config?.body && data.config.method !== 'GET';

  return (
    <BaseNode
      title={data.label || 'HTTP Request'}
      icon={<span className={`inline-flex items-center justify-center px-1 py-0.5 text-[8px] font-bold rounded mr-2 ${methodBadge} leading-none`}>{method}</span>}
      status={data.executionStatus || 'idle'}
      statusBadgeText={data.executionStatus && data.executionStatus !== 'idle' ? data.executionStatus : ''}
      selected={selected}
      nodeId={id}
      handleLeft={{ type: 'target' }}
      handleRight={{ type: 'source' }}
      collapsible={true}
      defaultExpanded={false}
      headerBg="bg-surface-overlay dark:bg-surface-dark-overlay"
      titleExtra={
        <>
          {data.schemaRefreshWarning && (
            <SchemaWarningBadge warning={data.schemaRefreshWarning} />
          )}
          {data.branchCount > 1 && (
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900/60 dark:text-purple-200 font-semibold flex items-center gap-0.5" title={`${data.branchCount} parallel branches`}>
              <Snowflake className="w-3 h-3" /> {data.branchCount}x
            </span>
          )}
        </>
      }
      className="max-w-[320px]"
    >
      {({ isExpanded }) => (
        <div className="p-2 space-y-1.5">
          {/* Method & URL (always visible) */}
          <div className="flex gap-1">
            <select
              className="nodrag px-2 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-primary"
              value={method}
              onChange={(e) => updateNodeData('method', e.target.value)}
            >
              <option value="GET">GET</option>
              <option value="POST">POST</option>
              <option value="PUT">PUT</option>
              <option value="DELETE">DEL</option>
              <option value="PATCH">PATCH</option>
            </select>
            <input
              type="text"
              placeholder="Enter URL..."
              className="nodrag flex-1 px-2 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary truncate"
              value={data.config?.url || ''}
              onChange={(e) => updateNodeData('url', e.target.value)}
            />
          </div>

          {/* Compact summary when collapsed */}
          {!isExpanded && (headerCount > 0 || extractorCount > 0 || hasBody) && (
            <div className="flex gap-1.5 text-[9px] text-text-muted dark:text-text-muted-dark">
              {headerCount > 0 && <span className="px-1.5 py-0.5 bg-surface-overlay dark:bg-surface-dark-overlay rounded">{headerCount} header{headerCount > 1 ? 's' : ''}</span>}
              {hasBody && <span className="px-1.5 py-0.5 bg-surface-overlay dark:bg-surface-dark-overlay rounded">body</span>}
              {extractorCount > 0 && <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded">{extractorCount} extractor{extractorCount > 1 ? 's' : ''}</span>}
            </div>
          )}

          {/* Expanded details */}
          {isExpanded && (
            <div className="space-y-1.5 pt-1 border-t border-border dark:border-border-dark">
              {/* Query Params */}
              <div>
                <label className="block text-[10px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">
                  Query Params <span className="font-normal text-text-muted dark:text-text-muted-dark">(key=value)</span>
                </label>
                <textarea
                  className="nodrag w-full px-1.5 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder={'page=1\nlimit=10'}
                  value={data.config?.queryParams || ''}
                  onChange={(e) => updateNodeData('queryParams', e.target.value)}
                />
              </div>

              {/* Path Variables */}
              <div>
                <label className="block text-[10px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">
                  Path Variables <span className="font-normal text-text-muted dark:text-text-muted-dark">(Use :varName in URL)</span>
                </label>
                <textarea
                  className="nodrag w-full px-1.5 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder={'userId={{prev.response.body.id}}'}
                  value={data.config?.pathVariables || ''}
                  onChange={(e) => updateNodeData('pathVariables', e.target.value)}
                />
              </div>

              {/* Headers */}
              <div>
                <label className="block text-[10px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">
                  Headers <span className="font-normal text-text-muted dark:text-text-muted-dark">(key=value)</span>
                </label>
                <textarea
                  className="nodrag w-full px-1.5 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder={'Content-Type=application/json\nAuthorization=Bearer {{variables.token}}'}
                  value={data.config?.headers || ''}
                  onChange={(e) => updateNodeData('headers', e.target.value)}
                />
              </div>

              {/* Cookies */}
              <div>
                <label className="block text-[10px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">
                  Cookies <span className="font-normal text-text-muted dark:text-text-muted-dark">(key=value)</span>
                </label>
                <textarea
                  className="nodrag w-full px-1.5 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                  rows={2}
                  placeholder={'session={{prev.response.cookies.session}}'}
                  value={data.config?.cookies || ''}
                  onChange={(e) => updateNodeData('cookies', e.target.value)}
                />
              </div>

              {/* Body */}
              {method !== 'GET' && (
                <div>
                  <label className="block text-[10px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">Body</label>
                  <textarea
                    className="nodrag w-full px-1.5 py-1 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[10px] font-mono focus:outline-none focus:ring-2 focus:ring-primary"
                    rows={3}
                    placeholder={'{\n  "key": "value"\n}'}
                    value={data.config?.body || ''}
                    onChange={(e) => updateNodeData('body', e.target.value)}
                  />
                </div>
              )}

              {/* Timeout */}
              <div>
                <label className="block text-[10px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">Timeout (seconds)</label>
                <input
                  type="number"
                  className="nodrag w-16 px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-xs focus:outline-none focus:ring-2 focus:ring-primary"
                  value={data.config?.timeout || 30}
                  onChange={(e) => updateNodeData('timeout', parseInt(e.target.value))}
                  min="1"
                />
              </div>

              {/* Extractors */}
              <div className="border-t border-border dark:border-border-dark pt-2 mt-2">
                <label className="block text-[10px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-1 flex items-center gap-1">
                  <Puzzle className="w-3.5 h-3.5" />
                  <span>Store Response As Variables</span>
                </label>
                <div className="space-y-1 mb-2">
                  {data.config?.extractors && Object.entries(data.config.extractors).length > 0 ? (
                    Object.entries(data.config.extractors).map(([varName, varPath]) => (
                      <div key={varName} className="flex gap-1 items-center text-[9px]">
                        <code className="bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 px-1.5 py-0.5 rounded flex-1">{varName}</code>
                        <span className="text-text-muted dark:text-text-muted-dark">←</span>
                        <code className="bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 px-1.5 py-0.5 rounded flex-1 truncate">{varPath}</code>
                        <button
                          className="text-red-500 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300 nodrag flex-shrink-0"
                          onClick={() => {
                            const newExtractors = { ...data.config.extractors };
                            delete newExtractors[varName];
                            updateNodeData('extractors', newExtractors);
                          }}
                          title="Delete extractor"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="text-[9px] text-text-muted dark:text-text-muted-dark italic">No extractors configured</div>
                  )}
                </div>
                <ExtractorForm onAdd={(varName, varPath) => {
                  const newExtractors = data.config?.extractors || {};
                  newExtractors[varName] = varPath;
                  updateNodeData('extractors', newExtractors);
                }} />
              </div>

              {/* File Uploads */}
              <FileUploadSection
                fileUploads={data.config?.fileUploads || []}
                onUpdate={(files) => updateNodeData('fileUploads', files)}
                variables={variables}
              />

              {/* Variable Hint */}
              <div className="text-[9px] text-text-muted dark:text-text-muted-dark p-1.5 bg-blue-50 dark:bg-blue-900/20 rounded space-y-0.5">
                <div><strong>💡 Variable Reference:</strong></div>
                <div className="pl-2 space-y-0.5">
                  <div>• Body: <code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{`{{prev.response.body.token}}`}</code></div>
                  <div>• Array: <code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{`{{prev.response.body.data[0].city}}`}</code></div>
                  <div>• Header: <code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{`{{prev.response.headers.content-type}}`}</code></div>
                  <div>• Cookie: <code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{`{{prev.response.cookies.session}}`}</code></div>
                  {variables && Object.keys(variables).length > 0 && (
                    <div className="mt-1 space-y-0.5">
                      <div className="font-semibold text-green-700 dark:text-green-300">Workflow Variables:</div>
                      {Object.keys(variables).map(v => (
                        <div key={v}>• <code className="bg-surface-overlay dark:bg-surface-dark-overlay px-1 rounded">{`{{variables.${v}}}`}</code></div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* Execution result (always visible when available) */}
          <ResponsePreview result={data.executionResult} status={data.executionStatus} />
        </div>
      )}
    </BaseNode>
  );
};

export default memo(HTTPRequestNode);
