import React, { memo, useState, useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { useReactFlow } from 'reactflow';
import AssertionEditor from '../AssertionEditor';
import Tooltip from '../Tooltip';

// Assertion form component
const AssertionForm = ({ onAdd }) => {
  const [source, setSource] = useState('prev');
  const [path, setPath] = useState('');
  const [operator, setOperator] = useState('equals');
  const [expectedValue, setExpectedValue] = useState('');
  const [errors, setErrors] = useState({ path: '', expectedValue: '' });

  const handleAdd = () => {
    console.log('Add assertion button clicked');
    console.log('Current values:', { source, path, operator, expectedValue });
    // Reset errors
    setErrors({ path: '', expectedValue: '' });

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
      setErrors({ path: '', expectedValue: '' });
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
        setErrors({ path: path.trim() ? '' : 'Path is required', expectedValue: expectedValue.trim() ? '' : 'Expected value required' });
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
    <div className="space-y-1.5 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded">
      {/* Source Selection */}
      <div>
        <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
          Assert On
        </label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-cyan-500"
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
          <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
            {source === 'prev' ? 'JSONPath (e.g., body.status)' : 
             source === 'variables' ? 'Variable name' :
             source === 'cookies' ? 'Cookie name' : 'Header name'}
          </label>
          <input
            type="text"
            placeholder={source === 'prev' ? 'body.status' : source === 'variables' ? 'tokenId' : 'Set-Cookie'}
            value={path}
            onChange={(e) => setPath(e.target.value)}
            className={`nodrag w-full px-1.5 py-0.5 border rounded text-[9px] focus:outline-none focus:ring-2 ` +
              (errors.path ? 'border-red-500 focus:ring-red-400 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-300' : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 focus:ring-cyan-500')}
          />
          {errors.path && (
            <div className="text-[9px] text-red-600 dark:text-red-400 mt-1">{errors.path}</div>
          )}
        </div>
      )}

      {/* Operator Selection */}
      <div>
        <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
          Operator
        </label>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          className="nodrag w-full px-1.5 py-0.5 border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-cyan-500"
        >
          <option value="equals">Equals (==)</option>
          <option value="notEquals">Not Equals (!=)</option>
          <option value="contains">Contains</option>
          <option value="notContains">Does Not Contain</option>
          <option value="gt">Greater Than (&gt;)</option>
          <option value="gte">Greater Than or Equal (&gt;=)</option>
          <option value="lt">Less Than (&lt;)</option>
          <option value="lte">Less Than or Equal (&lt;=)</option>
          <option value="exists">Exists</option>
          <option value="notExists">Does Not Exist</option>
        </select>
      </div>

      {/* Expected Value */}
      {!['exists', 'notExists'].includes(operator) && (
        <div>
          <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
            Expected Value
          </label>
          <input
            type="text"
            placeholder="200"
            value={expectedValue}
            onChange={(e) => setExpectedValue(e.target.value)}
            className={`nodrag w-full px-1.5 py-0.5 border rounded text-[9px] font-mono focus:outline-none focus:ring-2 ` +
              (errors.expectedValue ? 'border-red-500 focus:ring-red-400 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-300' : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 dark:placeholder-gray-400 focus:ring-cyan-500')}
          />
          {errors.expectedValue && (
            <div className="text-[9px] text-red-600 dark:text-red-400 mt-1">{errors.expectedValue}</div>
          )}
        </div>
      )}

      {/* Add Button */}
      <button
        onClick={handleAdd}
        className="w-full px-2 py-1 bg-green-500 dark:bg-green-600 hover:bg-green-600 dark:hover:bg-green-700 text-white text-[9px] font-semibold rounded nodrag transition-colors"
      >
        Add Assertion
      </button>
    </div>
  );
};

const AssertionNode = ({ id, data, selected }) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const { setNodes } = useReactFlow();

  // Inline editing state for assertions in the node UI
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editDraft, setEditDraft] = useState(null);

  const updateNodeData = useCallback(
    (key, value) => {
      console.log(`Updating node ${id} - ${key}:`, value);
      setNodes((nds) =>
        nds.map((node) =>
          node.id === id
            ? { ...node, data: { ...node.data, config: { ...node.data.config, [key]: value } } }
            : node
        )
      );
    },
    [id, setNodes]
  );

  const handleAddAssertion = (assertion) => {
    console.log('Adding assertion:', assertion);
    const assertions = data.config?.assertions || [];
    const updated = [...assertions, assertion];
    console.log('Updated assertions:', updated);
    updateNodeData('assertions', updated);
  };

  const handleDeleteAssertion = (index) => {
    const assertions = data.config?.assertions || [];
    const updated = assertions.filter((_, i) => i !== index);
    updateNodeData('assertions', updated);
  };

  return (
    <div
      className={`rounded-md bg-white dark:bg-gray-800 border-2 shadow-lg min-w-[250px] ${
        selected ? 'border-cyan-600 dark:border-cyan-500' : 'border-slate-300 dark:border-gray-600'
      } ${data?.invalid ? 'ring-2 ring-red-500 animate-pulse' : ''}`}
      style={{ fontSize: '12px' }}
    >
      <Handle type="target" position={Position.Left} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />

      {/* Header */}
      <div className="px-2 py-1.5 border-b-2 border-slate-300 dark:border-gray-700 bg-green-50 dark:bg-green-900">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-green-800 dark:text-green-200">✓ Assertions</h3>
          <Tooltip text={isExpanded ? 'Collapse' : 'Expand'}>
            <button
              onClick={() => setIsExpanded(!isExpanded)}
              className="text-xs text-gray-600 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 nodrag focus:outline-none focus:ring-0 active:bg-transparent select-none bg-transparent hover:bg-transparent"
              style={{ background: 'transparent', border: 'none', padding: 0, boxShadow: 'none', outline: 'none', WebkitTapHighlightColor: 'transparent' }}
              aria-expanded={isExpanded}
            >
              {/* Use variation selector-15 (U+FE0E) to force text glyph (monochrome) instead of emoji presentation */}
              <span style={{ background: 'transparent', boxShadow: 'none', outline: 'none', backgroundColor: 'transparent', border: 'none', padding: 0 }}>
                {isExpanded ? '\u25BC\uFE0E' : '\u25B6\uFE0E'}
              </span>
            </button>
          </Tooltip>
        </div>
      </div>

      {/* Content */}
      <div className="p-2 space-y-1.5">
        <div className="text-[9px] text-gray-600 dark:text-gray-400">
          {data.config?.assertions?.length || 0} assertion(s)
        </div>

        {isExpanded && (
          <div className="space-y-2 pt-1 border-t dark:border-gray-700">
            {/* Add Assertion Form */}
            <AssertionForm onAdd={handleAddAssertion} />

            {/* Assertions List */}
            {data.config?.assertions && data.config.assertions.length > 0 ? (
              <div className="space-y-1.5">
                {data.config.assertions.map((assertion, index) => (
                  <div
                    key={index}
                    className="p-1.5 bg-gray-50 dark:bg-gray-700 border border-gray-200 dark:border-gray-600 rounded space-y-0.5"
                  >
                    {/* If editing this assertion show inline form */}
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
                          const current = data.config?.assertions || [];
                          const updated = current.map((a, i) => (i === index ? updatedAssertion : a));
                          updateNodeData('assertions', updated);
                          setEditingIndex(-1);
                          setEditDraft(null);
                        }}
                      />
                    ) : (
                      <div className="flex items-start justify-between gap-1">
                        <div className="flex-1 text-[8px]">
                          <div className="text-green-700 dark:text-green-300 font-semibold">
                            {assertion.source === 'prev' ? '{{prev.' : 
                             assertion.source === 'variables' ? '{{variables.' :
                             assertion.source === 'status' ? 'status' :
                             assertion.source === 'cookies' ? 'Cookie: ' :
                             'Header: '}
                            {assertion.source !== 'status' && assertion.path}
                            {(assertion.source === 'prev' || assertion.source === 'variables') && '}}'}
                          </div>
                          <div className="text-gray-600 dark:text-gray-400 mt-0.5">
                            {assertion.operator} <code className="bg-gray-200 dark:bg-gray-600 px-0.5">{assertion.expectedValue}</code>
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              // Seed draft and enter edit mode
                              setEditingIndex(index);
                              setEditDraft({ ...assertion });
                            }}
                            className="px-1.5 py-0.5 bg-yellow-500 dark:bg-yellow-600 hover:bg-yellow-600 dark:hover:bg-yellow-700 text-white text-[8px] rounded nodrag transition-colors"
                          >
                            ✎
                          </button>
                          <button
                            onClick={() => handleDeleteAssertion(index)}
                            className="px-1.5 py-0.5 bg-red-500 dark:bg-red-600 hover:bg-red-600 dark:hover:bg-red-700 text-white text-[8px] rounded nodrag transition-colors"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-[9px] text-gray-500 dark:text-gray-400 italic py-2">
                No assertions yet. Add one above.
              </div>
            )}

            {/* Info */}
            <div className="text-[8px] text-gray-500 dark:text-gray-400 space-y-0.5 p-1 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
              <p><strong>ℹ️ Note:</strong> If ANY assertion fails, the workflow fails.</p>
              <p>Use prev.* to reference previous node results.</p>
            </div>
          </div>
        )}
      </div>

      <Handle type="source" position={Position.Right} className="w-2 h-2 bg-gray-400 dark:bg-gray-500" />
    </div>
  );
};

export default memo(AssertionNode);
