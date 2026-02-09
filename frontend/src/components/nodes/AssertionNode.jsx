import React, { memo, useState, useCallback } from 'react';
import { Handle, Position } from 'reactflow';
import { useReactFlow } from 'reactflow';
import AssertionEditor from '../AssertionEditor';
import Tooltip from '../Tooltip';
import { MdCheckCircle, MdError, MdExpandMore, MdExpandLess, MdInfoOutline, MdEdit, MdDelete, MdContentCopy } from 'react-icons/md';
import { HiMiniCheckBadge, HiMiniDocumentDuplicate } from 'react-icons/hi2';

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
    } else if (operator === 'count') {
      // Count needs path and expected value
      if (path.trim() && expectedValue.trim()) {
        console.log('Adding count assertion');
        onAdd({
          source: source.trim(),
          path: path.trim(),
          operator,
          expectedValue: expectedValue.trim(),
        });
        setErrors({ path: '', expectedValue: '' });
      } else {
        console.log('Path and expectedValue are required for count');
        setErrors({ path: path.trim() ? '' : 'Path is required', expectedValue: expectedValue.trim() ? '' : 'Count value required' });
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
          <option value="count">Count (array length)</option>
          <option value="exists">Exists</option>
          <option value="notExists">Does Not Exist</option>
        </select>
      </div>

      {/* Expected Value */}
      {!['exists', 'notExists'].includes(operator) && (
        <div>
          <label className="block text-[9px] font-semibold text-gray-700 dark:text-gray-300 mb-0.5">
            {operator === 'count' ? 'Expected Count' : 'Expected Value'}
          </label>
          <input
            type="text"
            placeholder={operator === 'count' ? '5' : '200'}
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
  const [showMenu, setShowMenu] = useState(false);

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
      <div className={`px-2 py-1.5 border-b-2 ${
        data.executionStatus === 'error' 
          ? 'border-red-300 dark:border-red-700 bg-red-50 dark:bg-red-900' 
          : 'border-slate-300 dark:border-gray-700 bg-green-50 dark:bg-green-900'
      }`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            {data.executionStatus === 'error' ? (
              <MdError className="w-5 h-5 text-red-700 dark:text-red-300" />
            ) : (
              <HiMiniCheckBadge className="w-5 h-5 text-green-700 dark:text-green-300" />
            )}
            <div className="flex items-center gap-1">
              <h3 className={`text-sm font-semibold ${
                data.executionStatus === 'error'
                  ? 'text-red-800 dark:text-red-200'
                  : 'text-green-800 dark:text-green-200'
              }`}>
                {data.label || 'Assertions'}
              </h3>
              {/* Show assertion counts if available */}
              {data.assertionStats && (
                <span className={`text-xs font-medium px-1.5 py-0.5 rounded ${
                  data.assertionStats.failedCount > 0
                    ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
                    : 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200'
                }`}>
                  {data.assertionStats.failedCount > 0
                    ? `${data.assertionStats.failedCount}/${data.assertionStats.totalCount} failed`
                    : `${data.assertionStats.passedCount}/${data.assertionStats.totalCount} passed`}
                </span>
              )}
            </div>
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
                    <HiMiniDocumentDuplicate className="w-4 h-4" />
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
                    <MdContentCopy className="w-4 h-4" />
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
            >
              {isExpanded ? <MdExpandLess className="w-4 h-4" /> : <MdExpandMore className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="p-2 space-y-1.5">
        <div className="text-[9px] text-gray-600 dark:text-gray-400">
          {data.config?.assertions?.length || 0} assertion(s)
        </div>

        {/* Execution Results Summary */}
        {data.executionStatus && data.assertionStats && (
          <div className={`mt-2 p-1.5 rounded text-[9px] ${
            data.assertionStats.failedCount > 0
              ? 'bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700'
              : 'bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700'
          }`}>
            <div className={`font-semibold mb-1 ${
              data.assertionStats.failedCount > 0
                ? 'text-red-800 dark:text-red-200'
                : 'text-green-800 dark:text-green-200'
            }`}>
              Last Run Results
            </div>
            <div className="space-y-0.5">
              <div className="text-green-700 dark:text-green-300">
                ✅ {data.assertionStats.passedCount} passed
              </div>
              {data.assertionStats.failedCount > 0 && (
                <div className="text-red-700 dark:text-red-300">
                  ❌ {data.assertionStats.failedCount} failed
                </div>
              )}
            </div>
          </div>
        )}

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
                        <div className="flex-1">
                          {/* Show execution result if available */}
                          {data.assertionStats && data.assertionStats.passed && data.assertionStats.passed.length > index && (
                            <div className="mb-1 text-[8px]">
                              {data.assertionStats.passed.some(p => p.index === index) ? (
                                <div className="text-green-700 dark:text-green-300 font-semibold">
                                  ✅ Passed
                                </div>
                              ) : null}
                            </div>
                          )}
                          {data.assertionStats && data.assertionStats.failed && data.assertionStats.failed.length > 0 && (
                            <div className="mb-1 text-[8px]">
                              {data.assertionStats.failed.some(f => f.index === index) ? (
                                <div>
                                  <div className="text-red-700 dark:text-red-300 font-semibold">
                                    ❌ Failed
                                  </div>
                                  <div className="text-red-600 dark:text-red-400 mt-0.5">
                                    {data.assertionStats.failed.find(f => f.index === index)?.message}
                                  </div>
                                </div>
                              ) : null}
                            </div>
                          )}
                          <div className="text-[8px]">
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
                        </div>
                        <div className="flex gap-1">
                          <button
                            onClick={() => {
                              // Seed draft and enter edit mode
                              setEditingIndex(index);
                              setEditDraft({ ...assertion });
                            }}
                            className="px-1.5 py-0.5 bg-yellow-500 dark:bg-yellow-600 hover:bg-yellow-600 dark:hover:bg-yellow-700 text-white text-[8px] rounded nodrag transition-colors"
                            title="Edit assertion"
                          >
                            <MdEdit className="w-3 h-3" />
                          </button>
                          <button
                            onClick={() => handleDeleteAssertion(index)}
                            className="px-1.5 py-0.5 bg-red-500 dark:bg-red-600 hover:bg-red-600 dark:hover:bg-red-700 text-white text-[8px] rounded nodrag transition-colors"
                            title="Delete assertion"
                          >
                            <MdDelete className="w-3 h-3" />
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
              <p className="flex items-center gap-1">
                <MdInfoOutline className="w-3 h-3 flex-shrink-0" />
                <span><strong>Pass/Fail:</strong> Connect the green ✓ handle for all-pass, red ✗ for any-fail.</span>
              </p>
              <p>Use prev.* to reference previous node results.</p>
            </div>
          </div>
        )}
      </div>

      {/* Dual output handles: Pass (top-right, green) and Fail (bottom-right, red) */}
      <Handle
        type="source"
        position={Position.Right}
        id="pass"
        className="!bg-green-500 dark:!bg-green-400 !w-2.5 !h-2.5 !border-2 !border-white dark:!border-gray-800"
        style={{ top: '35%' }}
        title="Pass — all assertions passed"
      />
      <div
        className="absolute text-[7px] font-bold text-green-600 dark:text-green-400 pointer-events-none select-none"
        style={{ right: 12, top: 'calc(35% - 5px)' }}
      >
        ✓
      </div>
      <Handle
        type="source"
        position={Position.Right}
        id="fail"
        className="!bg-red-500 dark:!bg-red-400 !w-2.5 !h-2.5 !border-2 !border-white dark:!border-gray-800"
        style={{ top: '65%' }}
        title="Fail — one or more assertions failed"
      />
      <div
        className="absolute text-[7px] font-bold text-red-600 dark:text-red-400 pointer-events-none select-none"
        style={{ right: 12, top: 'calc(65% - 5px)' }}
      >
        ✗
      </div>
    </div>
  );
};

export default memo(AssertionNode);
