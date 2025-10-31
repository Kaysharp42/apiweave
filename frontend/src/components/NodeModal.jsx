import React, { useState, useEffect, useRef } from 'react';
import AssertionEditor from './AssertionEditor';
import { Allotment } from 'allotment';
import { MdCheckCircle, MdInfoOutline, MdWarning, MdEdit, MdDelete, MdPublic, MdTimer, MdMergeType, MdCircle, MdClose, MdExpandMore, MdDescription } from 'react-icons/md';
import { HiMiniCheckBadge, HiMiniStop } from 'react-icons/hi2';

const NodeModal = ({ node, onClose, onSave }) => {
  // Use ref to store working data - NEVER update during editing
  const workingDataRef = useRef({ ...node.data });
  const [isAnimating, setIsAnimating] = useState(false);
  const modalRef = useRef(null);

  useEffect(() => {
    setIsAnimating(true);
  }, []);

  // Close modal when clicking outside (on backdrop or canvas)
  useEffect(() => {
    const handleClickOutside = (event) => {
      // Close if clicking on backdrop or outside modal
      if (modalRef.current && !modalRef.current.contains(event.target)) {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, []);

  const handleClose = () => {
    setIsAnimating(false);
    setTimeout(onClose, 200);
  };

  const handleSave = () => {
    onSave({ ...node, data: workingDataRef.current });
    handleClose();
  };

  const handleLabelChange = (newLabel) => {
    workingDataRef.current = { ...workingDataRef.current, label: newLabel };
  };

  // Get node type info - memoize to prevent recreation
  const getNodeIcon = (type) => {
    const iconProps = { className: 'w-6 h-6' };
    switch (type) {
      case 'http-request':
        return <MdPublic {...iconProps} />;
      case 'assertion':
        return <HiMiniCheckBadge {...iconProps} />;
      case 'delay':
        return <MdTimer {...iconProps} />;
      case 'merge':
        return <MdMergeType {...iconProps} />;
      case 'start':
        return <MdCircle {...iconProps} />;
      case 'end':
        return <HiMiniStop {...iconProps} />;
      default:
        return <MdCircle {...iconProps} />;
    }
  };

  const nodeTypes = {
    'http-request': { name: 'HTTP Request' },
    'assertion': { name: 'Assertion' },
    'delay': { name: 'Delay' },
    'merge': { name: 'Merge' },
    'start': { name: 'Start' },
    'end': { name: 'End' }
  };
  const nodeInfo = nodeTypes[node.type] || { name: 'Node' };

  return (
    <div 
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-300 ${
        isAnimating ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.4)' }}
    >
      {/* Backdrop - click to close */}
      <div 
        className="absolute inset-0 cursor-pointer" 
        onClick={handleClose}
      />
      
      {/* Modal Container - Centered Popup */}
      <div 
        ref={modalRef}
        className="relative z-10 rounded-xl overflow-visible flex flex-row transition-transform duration-300 p-6"
        style={{ 
          width: '90vw',
          maxWidth: '2000px',
          height: '85vh',
          maxHeight: '1400px',
          transform: isAnimating ? 'scale(1)' : 'scale(0.95)',
          gap: '40px'
        }}
      >
        {/* Left Card - Configuration */}
        <div 
          className="flex-1 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-xl overflow-hidden flex flex-col relative"
          style={{
            boxShadow: '8px 8px 24px rgba(0, 0, 0, 0.2), 0 20px 25px -5px rgba(0, 0, 0, 0.1), 0 10px 10px -5px rgba(0, 0, 0, 0.04)',
            transform: 'translateY(-20px)',
            zIndex: 10,
            marginRight: '0px'
          }}
        >
          {/* Back shadow layers for card stack effect */}
          <div className="absolute inset-0 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-xl" style={{
            transform: 'translateY(8px) translateX(8px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
            zIndex: -2
          }} />
          <div className="absolute inset-0 bg-gradient-to-br from-gray-50 to-gray-100 dark:from-gray-900 dark:to-gray-800 rounded-xl" style={{
            transform: 'translateY(4px) translateX(4px)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
            zIndex: -1
          }} />

          <div className="p-6 flex flex-col h-full relative z-0">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <div className="text-3xl text-gray-600 dark:text-gray-400">
                {getNodeIcon(node.type)}
              </div>
              <div>
                <h2 className="text-lg font-semibold text-gray-800 dark:text-gray-100">
                  {nodeInfo.name}
                </h2>
                <p className="text-xs text-gray-500 dark:text-gray-400">Configure node</p>
              </div>
            </div>
            <button
              onClick={handleClose}
              className="p-2 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors rounded-lg"
              title="Close"
            >
              <MdClose className="w-6 h-6" />
            </button>
          </div>

          {/* Node Name Card */}
          <div className="mb-4 p-4 bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow" style={{
            transform: 'translateY(0px)',
            boxShadow: '0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06)'
          }}>
            <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-2 uppercase tracking-wide">
              Node Name
            </label>
            <input
              type="text"
              defaultValue={node.data.label || ''}
              onChange={(e) => handleLabelChange(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded-md focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent transition-all"
              placeholder="Enter node name"
            />
          </div>

          {/* Configuration Card - 3D Stack Effect */}
          <div className="flex-1 relative">
            {/* Back shadow layers */}
            <div className="absolute inset-0 bg-white dark:bg-gray-800 rounded-lg" style={{
              transform: 'translateY(8px) translateX(8px)',
              boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
              zIndex: 1
            }} />
            <div className="absolute inset-0 bg-white dark:bg-gray-800 rounded-lg" style={{
              transform: 'translateY(4px) translateX(4px)',
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
              zIndex: 2
            }} />
            
            {/* Main card */}
            <div className="absolute inset-0 bg-white dark:bg-gray-800 rounded-lg p-4 overflow-y-auto" style={{
              boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.1), 0 4px 6px -2px rgba(0, 0, 0, 0.05)',
              zIndex: 3
            }}>
              {node.type === 'http-request' && (
                <HTTPRequestConfig
                  initialConfig={node.data.config || {}}
                  workingDataRef={workingDataRef}
                />
              )}
              {node.type === 'assertion' && (
                <AssertionConfig 
                  initialConfig={node.data.config || {}} 
                  workingDataRef={workingDataRef}
                />
              )}
              {node.type === 'delay' && (
                <DelayConfig 
                  initialConfig={node.data.config || {}} 
                  workingDataRef={workingDataRef}
                />
              )}
              {node.type === 'merge' && (
                <MergeConfig 
                  initialConfig={node.data.config || {}} 
                  workingDataRef={workingDataRef}
                />
              )}
              {(node.type === 'start' || node.type === 'end') && (
                <div className="p-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">
                    No configuration needed for {node.type} nodes.
                  </p>
                </div>
              )}
            </div>
          </div>

          {/* Footer Actions */}
          <div className="flex-shrink-0 mt-6 flex gap-3 justify-end">
            <button
              onClick={handleClose}
              className="px-4 py-2 text-sm border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-lg hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors font-medium"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              className="px-6 py-2 text-sm bg-cyan-600 dark:bg-cyan-700 text-white rounded-lg hover:bg-cyan-700 dark:hover:bg-cyan-800 transition-colors font-medium shadow-md hover:shadow-lg"
            >
              Save
            </button>
          </div>
          </div>
        </div>

        {/* Right Card - Response Output */}
        <div 
          className="flex-1 bg-white dark:bg-gray-800 rounded-xl overflow-hidden flex flex-col relative"
          style={{
            boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.15), 0 10px 10px -5px rgba(0, 0, 0, 0.08)',
            zIndex: 5,
            marginLeft: '-50px'
          }}
        >
          {/* Back shadow layers for card stack effect */}
          <div className="absolute inset-0 bg-white dark:bg-gray-800 rounded-xl" style={{
            transform: 'translateY(8px) translateX(8px)',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.08)',
            zIndex: -2
          }} />
          <div className="absolute inset-0 bg-white dark:bg-gray-800 rounded-xl" style={{
            transform: 'translateY(4px) translateX(4px)',
            boxShadow: '0 2px 8px rgba(0, 0, 0, 0.06)',
            zIndex: -1
          }} />

          <div className="p-6 flex flex-col h-full relative z-0">
            <OutputPanel 
              node={node}
              initialConfig={node.data.config || {}}
              output={node.data?.executionResult || null}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

// HTTP Request Configuration Component
const HTTPRequestConfig = React.memo(({ initialConfig, workingDataRef }) => {
  const [activeTab, setActiveTab] = useState('parameters');
  
  // Use refs for all inputs to avoid re-renders on every keystroke
  const urlRef = useRef(initialConfig.url || '');
  const methodRef = useRef(initialConfig.method || 'GET');
  const queryParamsRef = useRef(initialConfig.queryParams || '');
  const headersRef = useRef(initialConfig.headers || '');
  const cookiesRef = useRef(initialConfig.cookies || '');
  const bodyRef = useRef(initialConfig.body || '');
  const timeoutRef = useRef(initialConfig.timeout || 30);

  const updateRef = () => {
    const newConfig = {
      url: urlRef.current,
      method: methodRef.current,
      queryParams: queryParamsRef.current,
      headers: headersRef.current,
      cookies: cookiesRef.current,
      body: bodyRef.current,
      timeout: timeoutRef.current,
      // CRITICAL: Preserve extractors from original config
      extractors: initialConfig.extractors || {}
    };
    if (workingDataRef) {
      workingDataRef.current = { ...workingDataRef.current, config: newConfig };
    }
  };

  const handleFieldChange = () => {
    updateRef();
  };

  const TabButton = ({ id, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
        activeTab === id
          ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );

  const FormField = ({ label, children, hint }) => (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-gray-700 px-4">
        <TabButton id="parameters" label="Parameters" />
        <TabButton id="settings" label="Settings" />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <div className="space-y-4">
            <FormField label="HTTP Method">
              <div className="flex gap-2">
                {['GET', 'POST', 'PUT', 'DELETE', 'PATCH'].map((method) => (
                  <button
                    key={method}
                    onClick={() => {
                      methodRef.current = method;
                      updateRef();
                    }}
                    className={`px-3 py-1.5 text-xs font-medium rounded border transition-colors ${
                      methodRef.current === method
                        ? 'bg-cyan-600 text-white border-cyan-700'
                        : 'bg-white dark:bg-gray-700 text-gray-700 dark:text-gray-300 border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-600'
                    }`}
                  >
                    {method}
                  </button>
                ))}
              </div>
            </FormField>

            <FormField 
              label="URL" 
              hint="Supports variables: {{prev.response.body.id}} or {{variables.baseUrl}}"
            >
              <input
                type="text"
                defaultValue={initialConfig.url || ''}
                onBlur={() => updateRef()}
                onChange={(e) => {
                  urlRef.current = e.target.value;
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono"
                placeholder="https://api.example.com/endpoint"
              />
            </FormField>

            <FormField 
              label="Query Parameters" 
              hint="One per line: key=value"
            >
              <textarea
                defaultValue={initialConfig.queryParams || ''}
                onBlur={() => updateRef()}
                onChange={(e) => {
                  queryParamsRef.current = e.target.value;
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono"
                placeholder="page=1&#10;limit=10"
                rows={3}
              />
            </FormField>

            <FormField 
              label="Headers" 
              hint="One per line: key=value"
            >
              <textarea
                defaultValue={initialConfig.headers || ''}
                onBlur={() => updateRef()}
                onChange={(e) => {
                  headersRef.current = e.target.value;
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono"
                placeholder="Content-Type=application/json&#10;Authorization=Bearer {{variables.token}}"
                rows={3}
              />
            </FormField>

            <FormField 
              label="Cookies" 
              hint="One per line: key=value"
            >
              <textarea
                defaultValue={initialConfig.cookies || ''}
                onBlur={() => updateRef()}
                onChange={(e) => {
                  cookiesRef.current = e.target.value;
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono"
                placeholder="session={{variables.sessionId}}"
                rows={2}
              />
            </FormField>

            <FormField 
              label="Request Body" 
              hint="JSON format supported"
            >
              <textarea
                defaultValue={initialConfig.body || ''}
                onBlur={() => updateRef()}
                onChange={(e) => {
                  bodyRef.current = e.target.value;
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent font-mono"
                placeholder='{"key": "{{variables.value}}"}'
                rows={6}
              />
            </FormField>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-4">
            <FormField label="Request Timeout" hint="Maximum time to wait for response">
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  defaultValue={initialConfig.timeout || 30}
                  onBlur={() => updateRef()}
                  onChange={(e) => {
                    timeoutRef.current = parseInt(e.target.value) || 30;
                  }}
                  className="w-24 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
                  min="1"
                  max="300"
                />
                <span className="text-sm text-gray-600 dark:text-gray-400">seconds</span>
              </div>
            </FormField>

            <FormField label="Extract Variables" hint="Save response values as workflow variables">
              <div className="text-xs text-gray-500 dark:text-gray-400">
                Configure in the node's extractors field or Variables Panel
              </div>
            </FormField>
          </div>
        )}
      </div>
    </div>
  );
});
HTTPRequestConfig.displayName = 'HTTPRequestConfig';

// Output Panel Component
const OutputPanel = React.memo(({ node, initialConfig, output }) => {
  const [activeTab, setActiveTab] = useState('body');

  const statusCode = output?.statusCode;
  const headers = output?.headers || {};
  const cookies = output?.cookies || {};
  const body = output?.body;

  const statusColor = !statusCode
    ? 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
    : statusCode >= 200 && statusCode < 300
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200'
      : statusCode >= 300 && statusCode < 400
        ? 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-200'
        : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200';

  const TabButton = ({ id, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-3 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${
        activeTab === id
          ? 'bg-cyan-600 text-white shadow-sm'
          : 'bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-500'
      }`}
    >
      {label}
    </button>
  );

  const CodeBlock = ({ value }) => (
    <pre className="w-full h-full overflow-auto p-4 text-xs text-gray-700 dark:text-gray-300 font-mono bg-gray-50 dark:bg-gray-900 border-0 leading-relaxed">
      {typeof value === 'string' ? value : JSON.stringify(value, null, 2)}
    </pre>
  );

  return (
    <div className="h-full flex flex-col bg-white dark:bg-gray-800">
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between bg-gradient-to-r from-gray-50 to-white dark:from-gray-800 dark:to-gray-700">
        <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-2">
          📤 Response
        </h3>
        {node.type === 'http-request' && statusCode && (
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2 py-1 rounded ${statusColor}`}>
              {statusCode}
            </span>
            {output?.duration !== undefined && (
              <span className="text-xs font-semibold px-2 py-1 rounded bg-blue-100 dark:bg-blue-900 text-blue-700 dark:text-blue-300">
                ⏱ {output.duration >= 1000 
                  ? `${(output.duration / 1000).toFixed(2)}s` 
                  : `${output.duration}ms`}
              </span>
            )}
          </div>
        )}
      </div>

      {/* Empty State */}
      {!output && (
        <div className="flex-1 flex items-center justify-center p-6">
          <div className="text-center">
            <MdDescription className="w-16 h-16 mx-auto mb-4 text-gray-300 dark:text-gray-600" />
            <p className="text-sm text-gray-500 dark:text-gray-400 mb-2">
              Execute this node to view data
            </p>
            <button className="text-xs text-cyan-600 dark:text-cyan-400 hover:underline">
              or set mock data
            </button>
          </div>
        </div>
      )}

      {/* Output Content for HTTP Request */}
      {output && node.type === 'http-request' && (
        <>
          {/* Method & URL */}
          <div className="flex-shrink-0 px-4 py-3 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-600">
            <div className="flex items-center gap-2 text-xs">
              <span className="font-semibold px-2 py-1 rounded bg-cyan-100 dark:bg-cyan-900 text-cyan-700 dark:text-cyan-300">
                {initialConfig.method || 'GET'}
              </span>
              <span className="text-gray-600 dark:text-gray-300 truncate font-mono text-xs">
                {initialConfig.url || '—'}
              </span>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex-shrink-0 px-4 py-2 bg-gray-50 dark:bg-gray-700/50 border-b border-gray-100 dark:border-gray-600 flex gap-1 overflow-x-auto">
            <TabButton id="body" label="Body" />
            <TabButton id="headers" label={`Headers (${Object.keys(headers).length})`} />
            <TabButton id="cookies" label={`Cookies (${Object.keys(cookies).length})`} />
            <TabButton id="raw" label="Raw" />
          </div>

          {/* Content */}
          <div className="flex-1 overflow-auto bg-white dark:bg-gray-800">
            {activeTab === 'body' && <CodeBlock value={body ?? '(empty)'} />}
            {activeTab === 'headers' && <CodeBlock value={headers} />}
            {activeTab === 'cookies' && <CodeBlock value={cookies} />}
            {activeTab === 'raw' && <CodeBlock value={output} />}
          </div>
        </>
      )}

      {/* Output Content for Other Nodes */}
      {output && node.type !== 'http-request' && (
        <div className="flex-1 overflow-auto bg-white dark:bg-gray-800 p-4">
          <CodeBlock value={output} />
        </div>
      )}
    </div>
  );
});
OutputPanel.displayName = 'OutputPanel';

// Assertion Form Component for Modal
const AssertionFormModal = ({ onAdd }) => {
  const [source, setSource] = useState('prev');
  const [path, setPath] = useState('');
  const [operator, setOperator] = useState('equals');
  const [expectedValue, setExpectedValue] = useState('');
  const [errors, setErrors] = useState({ path: '', expectedValue: '' });

  const handleAdd = () => {
    console.log('Add assertion button clicked');
    console.log('Current values:', { source, path, operator, expectedValue });
    
    // Validate based on source and operator
    if (source === 'status') {
      // Status doesn't need a path
      console.log('Adding status assertion');
      onAdd({
        source: source.trim(),
        path: '',
        operator,
        expectedValue: expectedValue.trim(),
      });
    } else if (['exists', 'notExists'].includes(operator)) {
      // Exists/NotExists don't need expected value
      if (path.trim()) {
        console.log('Adding exists/notExists assertion');
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator,
          expectedValue: '',
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        console.log('Path is required for this operator');
        setErrors({ path: 'Path is required', expectedValue: '' });
        return;
      }
    } else if (operator === 'count') {
      // Count operator needs path and expected value
      if (path.trim() && expectedValue.trim()) {
        console.log('Adding count assertion');
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator: 'count',
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        console.log('Path and expectedValue are required for count operator');
        setErrors({ path: path.trim() ? '' : 'Path is required', expectedValue: expectedValue.trim() ? '' : 'Expected count is required' });
        return;
      }
    } else {
      // All others need path and expected value
      if (path.trim() && expectedValue.trim()) {
        console.log('Adding standard assertion');
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator,
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        console.log('Path and expectedValue are required');
        setErrors({ path: path.trim() ? '' : 'Path is required', expectedValue: expectedValue.trim() ? '' : 'Expected value is required' });
        return;
      }
    }
    
    // Reset form
    setPath('');
    setExpectedValue('');
    setSource('prev');
    setOperator('equals');
  };

  return (
    <div className="space-y-3 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
      {/* Source Selection */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
          Assert On
        </label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="prev">Previous Node Result (prev.*)</option>
          <option value="variables">Workflow Variables (variables.*)</option>
          <option value="status">HTTP Status Code</option>
          <option value="cookies">Cookies</option>
          <option value="headers">Response Headers</option>
        </select>
      </div>

      {/* Path/Field Selection */}
      {source !== 'status' && (
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            {source === 'prev' ? 'JSONPath (e.g., body.status)' : 
             source === 'variables' ? 'Variable name' :
             source === 'cookies' ? 'Cookie name' : 'Header name'}
          </label>
          <div>
            <input
              type="text"
              placeholder={source === 'prev' ? 'body.status' : source === 'variables' ? 'tokenId' : 'Set-Cookie'}
              value={path}
              onChange={(e) => { setPath(e.target.value); setErrors({ ...errors, path: '' }); }}
              className={`w-full px-3 py-2 border rounded text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500 ${errors.path ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'}`}
            />
            {errors.path && <div className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.path}</div>}
          </div>
        </div>
      )}

      {/* Operator Selection */}
      <div>
        <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
          Operator
        </label>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-sm focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="equals">Equals (==)</option>
          <option value="notEquals">Not Equals (!=)</option>
          <option value="contains">Contains</option>
          <option value="notContains">Does Not Contain</option>
          <option value="gt">Greater Than (&gt;)</option>
          <option value="gte">Greater Than or Equal (&gt;=)</option>
          <option value="lt">Less Than (&lt;)</option>
          <option value="lte">Less Than or Equal (&lt;=)</option>
          <option value="count">Count (array length)</option>
          <option value="exists">Exists</option>
          <option value="notExists">Does Not Exist</option>
        </select>
      </div>

      {/* Expected Value */}
      {!['exists', 'notExists'].includes(operator) && (
        <div>
          <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1.5">
            {operator === 'count' ? 'Expected Count' : 'Expected Value'}
          </label>
          <div>
            <input
              type="text"
              placeholder={operator === 'count' ? '5' : '200'}
              value={expectedValue}
              onChange={(e) => { setExpectedValue(e.target.value); setErrors({ ...errors, expectedValue: '' }); }}
              className={`w-full px-3 py-2 border rounded text-sm font-mono focus:outline-none focus:ring-2 focus:ring-cyan-500 ${errors.expectedValue ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'}`}
            />
            {errors.expectedValue && <div className="text-xs text-red-600 dark:text-red-400 mt-1">{errors.expectedValue}</div>}
          </div>
        </div>
      )}

      {/* Add Button */}
      <button
        onClick={handleAdd}
        className="w-full px-4 py-2 bg-green-500 dark:bg-green-600 hover:bg-green-600 dark:hover:bg-green-700 text-white text-sm font-semibold rounded transition-colors shadow-md hover:shadow-lg"
      >
        + Add Assertion
      </button>
    </div>
  );
};

// Assertion Configuration Component
const AssertionConfig = React.memo(({ initialConfig, workingDataRef }) => {
  const [activeTab, setActiveTab] = useState('parameters');
  const [assertions, setAssertions] = useState(initialConfig.assertions || []);
  // Editing state for inline modification of existing assertions
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editDraft, setEditDraft] = useState(null);

  const handleAddAssertion = (assertion) => {
    console.log('Adding assertion:', assertion);
    const updated = [...assertions, assertion];
    console.log('Updated assertions:', updated);
    setAssertions(updated);
    
    // Update working data ref
    if (workingDataRef) {
      workingDataRef.current = {
        ...workingDataRef.current,
        config: {
          ...workingDataRef.current.config,
          assertions: updated
        }
      };
    }
  };

  const handleDeleteAssertion = (index) => {
    console.log('Deleting assertion at index:', index);
    const updated = assertions.filter((_, i) => i !== index);
    console.log('Updated assertions after delete:', updated);
    setAssertions(updated);
    
    // Update working data ref
    if (workingDataRef) {
      workingDataRef.current = {
        ...workingDataRef.current,
        config: {
          ...workingDataRef.current.config,
          assertions: updated
        }
      };
    }
  };

  const TabButton = ({ id, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
        activeTab === id
          ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-gray-700 px-4">
        <TabButton id="parameters" label="Assertions" />
        <TabButton id="settings" label="Settings" />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <div className="space-y-4">
            {/* Info Banner */}
            <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg text-sm text-blue-800 dark:text-blue-200">
              <p className="font-medium mb-1 flex items-center gap-2">
                <MdInfoOutline className="w-4 h-4" />
                <span>Assertion Configuration</span>
              </p>
              <p className="text-xs">
                Assertions configured: <span className="font-bold">{assertions.length}</span>
              </p>
              <p className="text-xs mt-2">
                If ANY assertion fails, the workflow will fail at this node.
              </p>
            </div>

            {/* Add Assertion Form */}
            <AssertionFormModal onAdd={handleAddAssertion} />

            {/* Assertions List */}
            {assertions.length > 0 ? (
              <div className="space-y-3">
                <h4 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                  Current Assertions ({assertions.length})
                </h4>
                {assertions.map((assertion, index) => (
                  <div
                    key={index}
                    className="p-3 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded-lg space-y-2"
                  >
                    {/* If this assertion is being edited show shared AssertionEditor */}
                    {editingIndex === index ? (
                      <AssertionEditor
                        value={editDraft}
                        onChange={(next) => setEditDraft(next)}
                        onCancel={() => {
                          setEditingIndex(-1);
                          setEditDraft(null);
                        }}
                        onSave={() => {
                          const updatedAssertion = { ...editDraft };
                          const updated = assertions.map((a, i) => (i === index ? updatedAssertion : a));
                          setAssertions(updated);
                          // Update working data ref
                          if (workingDataRef) {
                            workingDataRef.current = {
                              ...workingDataRef.current,
                              config: {
                                ...workingDataRef.current.config,
                                assertions: updated
                              }
                            };
                          }
                          setEditingIndex(-1);
                          setEditDraft(null);
                        }}
                      />
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 text-sm">
                          <div className="text-green-700 dark:text-green-300 font-semibold font-mono">
                            {assertion.source === 'prev' ? '{{prev.' : 
                             assertion.source === 'variables' ? '{{variables.' :
                             assertion.source === 'status' ? 'status' :
                             assertion.source === 'cookies' ? 'Cookie: ' :
                             'Header: '}
                            {assertion.source !== 'status' && assertion.path}
                            {(assertion.source === 'prev' || assertion.source === 'variables') && '}}'}
                          </div>
                          <div className="text-gray-600 dark:text-gray-400 mt-1 text-xs">
                            <span className="font-medium">{assertion.operator}</span>
                            {assertion.expectedValue && (
                              <>
                                {' '}<code className="bg-gray-200 dark:bg-gray-600 px-1.5 py-0.5 rounded">{assertion.expectedValue}</code>
                              </>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-col gap-2">
                          <button
                            onClick={() => {
                              // Start editing: seed draft with current assertion
                              setEditingIndex(index);
                              setEditDraft({ ...assertion });
                            }}
                            className="px-3 py-1.5 bg-yellow-500 dark:bg-yellow-600 hover:bg-yellow-600 dark:hover:bg-yellow-700 text-white text-xs font-semibold rounded transition-colors flex-shrink-0"
                            title="Edit assertion"
                          >
                            <MdEdit className="w-4 h-4 inline" /> Edit
                          </button>
                          <button
                            onClick={() => handleDeleteAssertion(index)}
                            className="px-3 py-1.5 bg-red-500 dark:bg-red-600 hover:bg-red-600 dark:hover:bg-red-700 text-white text-xs font-semibold rounded transition-colors flex-shrink-0"
                            title="Delete assertion"
                          >
                            <MdDelete className="w-4 h-4 inline" /> Delete
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-sm text-gray-500 dark:text-gray-400 italic text-center py-6 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                No assertions yet. Add one above to get started.
              </div>
            )}

            {/* Help Text */}
            <div className="text-xs text-gray-500 dark:text-gray-400 space-y-1 p-3 bg-gray-50 dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700">
              <p><strong>💡 Tips:</strong></p>
              <ul className="list-disc list-inside space-y-0.5 ml-2">
                <li>Use <code className="bg-gray-200 dark:bg-gray-600 px-1">prev.*</code> to reference the previous node's response</li>
                <li>Use <code className="bg-gray-200 dark:bg-gray-600 px-1">variables.*</code> to reference workflow variables</li>
                <li>JSONPath example: <code className="bg-gray-200 dark:bg-gray-600 px-1">body.data[0].id</code></li>
              </ul>
            </div>
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500 dark:text-gray-400">
              No additional settings for assertion nodes.
            </p>
          </div>
        )}
      </div>
    </div>
  );
});
AssertionConfig.displayName = 'AssertionConfig';

// Delay Configuration Component
const DelayConfig = React.memo(({ initialConfig, workingDataRef }) => {
  const [activeTab, setActiveTab] = useState('parameters');
  
  const durationRef = useRef(initialConfig.duration || 1000);

  const updateRef = () => {
    const newConfig = {
      duration: durationRef.current
    };
    if (workingDataRef) {
      workingDataRef.current = { ...workingDataRef.current, config: newConfig };
    }
  };

  const TabButton = ({ id, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
        activeTab === id
          ? 'border-cyan-500 text-cyan-600 dark:text-cyan-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );

  const FormField = ({ label, children, hint }) => (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
    </div>
  );

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-gray-700 px-4">
        <TabButton id="parameters" label="Parameters" />
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        <FormField 
          label="Duration" 
          hint={`${(durationRef.current || 1000) / 1000} second${(durationRef.current || 1000) !== 1000 ? 's' : ''}`}
        >
          <div className="flex items-center gap-2">
            <input
              type="number"
              defaultValue={initialConfig.duration || 1000}
              onBlur={() => updateRef()}
              onChange={(e) => {
                durationRef.current = parseInt(e.target.value) || 1000;
              }}
              className="w-32 px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-cyan-500 focus:border-transparent"
              min="100"
              step="100"
            />
            <span className="text-sm text-gray-600 dark:text-gray-400">milliseconds</span>
          </div>
        </FormField>
      </div>
    </div>
  );
});
DelayConfig.displayName = 'DelayConfig';

// Merge Configuration Component
const MergeConfig = React.memo(({ initialConfig, workingDataRef }) => {
  const [activeTab, setActiveTab] = useState('parameters');
  const [currentStrategy, setCurrentStrategy] = useState(initialConfig.mergeStrategy || 'all');
  const [conditions, setConditions] = useState(initialConfig.conditions || []);
  const [conditionLogic, setConditionLogic] = useState(initialConfig.conditionLogic || 'OR');
  
  const strategyRef = useRef(initialConfig.mergeStrategy || 'all');
  const conditionsRef = useRef(initialConfig.conditions || []);
  const conditionLogicRef = useRef(initialConfig.conditionLogic || 'OR');

  console.log('MergeConfig rendered - currentStrategy:', currentStrategy, 'activeTab:', activeTab);

  const updateRef = () => {
    const newConfig = {
      mergeStrategy: strategyRef.current,
      conditions: conditionsRef.current,
      conditionLogic: conditionLogicRef.current
    };
    if (workingDataRef) {
      workingDataRef.current = { ...workingDataRef.current, config: newConfig };
    }
  };

  const TabButton = ({ id, label }) => (
    <button
      onClick={() => setActiveTab(id)}
      className={`px-4 py-2 text-sm font-medium transition-colors border-b-2 ${
        activeTab === id
          ? 'border-purple-500 text-purple-600 dark:text-purple-400'
          : 'border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
      }`}
    >
      {label}
    </button>
  );

  const FormField = ({ label, children, hint }) => (
    <div className="mb-4">
      <label className="block text-xs font-medium text-gray-500 dark:text-gray-400 mb-1.5 uppercase tracking-wide">
        {label}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1 italic">{hint}</p>}
    </div>
  );

  const strategyDescriptions = {
    all: '⏳ Waits for ALL incoming branches to complete before continuing (AND logic)',
    any: '⚡ Continues as soon as ANY branch completes (OR logic)',
    first: '🏃 Uses the first branch that completes and ignores the rest',
    conditional: '🎯 Merges only branches that match specified conditions (filters by status, response values, etc.)'
  };

  const addCondition = () => {
    const newConditions = [
      ...conditionsRef.current,
      { branchIndex: 0, field: 'statusCode', operator: 'equals', value: '200' }
    ];
    conditionsRef.current = newConditions;
    setConditions(newConditions); // Trigger re-render
    updateRef();
  };

  const removeCondition = (index) => {
    const newConditions = conditionsRef.current.filter((_, i) => i !== index);
    conditionsRef.current = newConditions;
    setConditions(newConditions); // Trigger re-render
    updateRef();
  };

  const updateCondition = (index, updates) => {
    const newConditions = conditionsRef.current.map((cond, i) =>
      i === index ? { ...cond, ...updates } : cond
    );
    conditionsRef.current = newConditions;
    setConditions(newConditions); // Trigger re-render
    updateRef();
  };

  return (
    <div className="flex flex-col h-full">
      {/* Tabs */}
      <div className="flex-shrink-0 flex border-b border-gray-200 dark:border-gray-700 px-4">
        <TabButton id="parameters" label="Merge Strategy" />
        {currentStrategy === 'conditional' && (
          <TabButton id="conditions" label="Conditions" />
        )}
      </div>

      {/* Tab Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === 'parameters' && (
          <>
            <FormField 
              label="Wait Strategy" 
              hint={strategyDescriptions[currentStrategy] || strategyDescriptions.all}
            >
              <select
                value={currentStrategy}
                onChange={(e) => {
                  const newStrategy = e.target.value;
                  console.log('Strategy changed to:', newStrategy);
                  strategyRef.current = newStrategy;
                  setCurrentStrategy(newStrategy);
                  updateRef();
                  // Switch to conditions tab if conditional selected
                  if (newStrategy === 'conditional') {
                    console.log('Switching to conditions tab');
                    setActiveTab('conditions');
                  }
                }}
                className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent"
              >
                <option value="all">Wait for All (AND)</option>
                <option value="any">Wait for Any (OR)</option>
                <option value="first">First Completes</option>
                <option value="conditional">Conditional Merge</option>
              </select>
            </FormField>

            {/* Info Box */}
            <div className="mt-6 p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700 rounded-lg">
              <h4 className="text-sm font-semibold text-purple-900 dark:text-purple-200 mb-2">
                📝 How Merge Works
              </h4>
              <ul className="text-xs text-purple-800 dark:text-purple-300 space-y-1">
                <li>• Multiple edges leading to this node create parallel branches</li>
                <li>• Access branch results using: <code className="bg-white dark:bg-gray-800 px-1 py-0.5 rounded">{'{{prev[0].response}}'}</code></li>
                <li>• Index [0], [1], [2]... corresponds to branch execution order</li>
                <li>• Use <code className="bg-white dark:bg-gray-800 px-1 py-0.5 rounded">{'{{prev.response}}'}</code> for single predecessor (backward compatible)</li>
                {currentStrategy === 'conditional' && (
                  <li className="mt-2 pt-2 border-t border-purple-300 dark:border-purple-700">
                    • <strong>Conditional:</strong> Define conditions to filter which branches to merge
                  </li>
                )}
              </ul>
            </div>
          </>
        )}

        {activeTab === 'conditions' && currentStrategy === 'conditional' && (
          <div>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300">
                Merge Conditions
              </h3>
              <button
                onClick={addCondition}
                className="px-3 py-1 text-xs bg-purple-600 text-white rounded hover:bg-purple-700 transition-colors"
              >
                + Add Condition
              </button>
            </div>

            {/* Condition Logic Selector */}
            {conditions.length > 1 && (
              <div className="mb-4 p-3 bg-gray-50 dark:bg-gray-900 border border-gray-300 dark:border-gray-600 rounded-lg">
                <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                  Evaluation Logic:
                </label>
                <div className="flex gap-3">
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="conditionLogic"
                      value="OR"
                      checked={conditionLogic === 'OR'}
                      onChange={(e) => {
                        const newLogic = e.target.value;
                        conditionLogicRef.current = newLogic;
                        setConditionLogic(newLogic);
                        updateRef();
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      <strong>OR</strong> - Match ANY condition
                    </span>
                  </label>
                  <label className="flex items-center cursor-pointer">
                    <input
                      type="radio"
                      name="conditionLogic"
                      value="AND"
                      checked={conditionLogic === 'AND'}
                      onChange={(e) => {
                        const newLogic = e.target.value;
                        conditionLogicRef.current = newLogic;
                        setConditionLogic(newLogic);
                        updateRef();
                      }}
                      className="mr-2"
                    />
                    <span className="text-sm text-gray-700 dark:text-gray-300">
                      <strong>AND</strong> - Match ALL conditions
                    </span>
                  </label>
                </div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mt-2 flex items-center gap-1">
                  <MdCheckCircle className="w-4 h-4 text-green-600" />
                  <span>
                    {conditionLogic === 'OR' 
                      ? 'A branch is merged if it matches at least one condition' 
                      : 'A branch is merged only if it matches all conditions'}
                  </span>
                </p>
              </div>
            )}

            {conditions.length === 0 ? (
              <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-8 border-2 border-dashed border-gray-300 dark:border-gray-600 rounded-lg">
                No conditions defined. Click "+ Add Condition" to start.
              </div>
            ) : (
              <div className="space-y-3">
                {conditions.map((condition, index) => (
                  <div
                    key={index}
                    className="p-3 border border-gray-300 dark:border-gray-600 rounded-lg bg-gray-50 dark:bg-gray-900"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Condition {index + 1} {conditions.length > 1 && index < conditions.length - 1 && (
                          <span className="ml-2 text-purple-600 dark:text-purple-400 font-bold">
                            {conditionLogic}
                          </span>
                        )}
                      </span>
                      <button
                        onClick={() => removeCondition(index)}
                        className="text-red-600 hover:text-red-700 dark:text-red-400 dark:hover:text-red-300"
                      >
                        <MdClose className="w-4 h-4" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2">
                      {/* Branch Index */}
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Branch</label>
                        <input
                          type="number"
                          value={condition.branchIndex}
                          onChange={(e) => updateCondition(index, { branchIndex: parseInt(e.target.value) || 0 })}
                          className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                          min="0"
                        />
                      </div>

                      {/* Field */}
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                          Field
                          <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400">
                            (supports variables)
                          </span>
                        </label>
                        <input
                          type="text"
                          value={condition.field}
                          onChange={(e) => updateCondition(index, { field: e.target.value })}
                          className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono"
                          placeholder="statusCode or {{prev[0].response.body.name}}"
                        />
                        <div className="mt-0.5 text-[9px] text-gray-500 dark:text-gray-400">
                          Common: <code>statusCode</code>, <code>response.body</code>, <code>response.headers</code>
                        </div>
                      </div>

                      {/* Operator */}
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">Operator</label>
                        <select
                          value={condition.operator}
                          onChange={(e) => updateCondition(index, { operator: e.target.value })}
                          className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100"
                        >
                          <option value="equals">Equals</option>
                          <option value="notEquals">Not Equals</option>
                          <option value="contains">Contains</option>
                          <option value="gt">Greater Than</option>
                          <option value="lt">Less Than</option>
                          <option value="exists">Exists</option>
                        </select>
                      </div>

                      {/* Value */}
                      <div>
                        <label className="block text-xs text-gray-600 dark:text-gray-400 mb-1">
                          Value
                          <span className="ml-1 text-[10px] text-purple-600 dark:text-purple-400">
                            (supports variables)
                          </span>
                        </label>
                        <input
                          type="text"
                          value={condition.value}
                          onChange={(e) => updateCondition(index, { value: e.target.value })}
                          className="w-full px-2 py-1 text-xs border border-gray-300 dark:border-gray-600 rounded bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 font-mono"
                          placeholder="200 or {{prev[0].id}}"
                        />
                      </div>
                    </div>
                    
                    {/* Variable hint for this condition */}
                    <div className="mt-2 text-[10px] text-gray-500 dark:text-gray-400 bg-gray-100 dark:bg-gray-800 rounded p-1.5">
                      💡 Examples: <code className="text-purple-600 dark:text-purple-400">200</code>, 
                      <code className="ml-1 text-purple-600 dark:text-purple-400">{'{{prev[0].response.body.status}}'}</code>,
                      <code className="ml-1 text-purple-600 dark:text-purple-400">{'{{variables.expectedCode}}'}</code>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Hint */}
            <div className="mt-4 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-700 rounded-lg">
              <p className="text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <span>💡</span>
                <span><strong>How it works:</strong> {conditionLogic === 'OR' 
                  ? 'Each branch is evaluated independently. If a branch matches ANY condition, it passes.' 
                  : 'Each branch is evaluated independently. A branch passes ONLY if it matches ALL conditions.'}</span>
              </p>
              <p className="text-xs text-red-700 dark:text-red-400 mt-2 font-semibold flex items-start gap-2">
                <MdWarning className="w-4 h-4 flex-shrink-0 mt-0.5" />
                <span><strong>Important:</strong> If ANY branch fails its conditions, the entire merge FAILS and the workflow stops (like an assertion).</span>
              </p>
              <p className="text-xs text-blue-700 dark:text-blue-400 mt-2 flex items-start gap-2">
                <span>🔧</span>
                <span><strong>Variable support:</strong> Use <code className="bg-white dark:bg-gray-800 px-1 rounded">{'{{prev[N].path}}'}</code> to reference other branch data or <code className="bg-white dark:bg-gray-800 px-1 rounded">{'{{variables.name}}'}</code> for workflow variables.</span>
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
});
MergeConfig.displayName = 'MergeConfig';

export default NodeModal;

