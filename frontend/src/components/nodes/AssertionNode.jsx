import React, { memo, useState, useCallback } from 'react';
import { Handle, Position, useReactFlow } from 'reactflow';
import BaseNode from '../atoms/flow/BaseNode';
import AssertionEditor from '../AssertionEditor';
import Tooltip from '../Tooltip';
import { CheckCircle, XCircle, Info, Pencil, Trash2, BadgeCheck } from 'lucide-react';

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
        <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">
          Assert On
        </label>
        <select
          value={source}
          onChange={(e) => setSource(e.target.value)}
          className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-primary"
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
          <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">
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
              (errors.path ? 'border-red-500 focus:ring-red-400 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-300' : 'border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark focus:ring-primary')}
          />
          {errors.path && (
            <div className="text-[9px] text-red-600 dark:text-red-400 mt-1">{errors.path}</div>
          )}
        </div>
      )}

      {/* Operator Selection */}
      <div>
        <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">
          Operator
        </label>
        <select
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          className="nodrag w-full px-1.5 py-0.5 border border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark rounded text-[9px] focus:outline-none focus:ring-2 focus:ring-primary"
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
          <label className="block text-[9px] font-semibold text-text-secondary dark:text-text-secondary-dark mb-0.5">
            {operator === 'count' ? 'Expected Count' : 'Expected Value'}
          </label>
          <input
            type="text"
            placeholder={operator === 'count' ? '5' : '200'}
            value={expectedValue}
            onChange={(e) => setExpectedValue(e.target.value)}
            className={`nodrag w-full px-1.5 py-0.5 border rounded text-[9px] font-mono focus:outline-none focus:ring-2 ` +
              (errors.expectedValue ? 'border-red-500 focus:ring-red-400 bg-red-50 dark:bg-red-900/20 text-red-900 dark:text-red-300' : 'border-border dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark focus:ring-primary')}
          />
          {errors.expectedValue && (
            <div className="text-[9px] text-red-600 dark:text-red-400 mt-1">{errors.expectedValue}</div>
          )}
        </div>
      )}

      {/* Add Button */}
      <button
        onClick={handleAdd}
        className="w-full px-2 py-1 bg-status-success hover:bg-green-700 text-white text-[9px] font-semibold rounded nodrag transition-colors"
      >
        Add Assertion
      </button>
    </div>
  );
};


const AssertionNode = ({ id, data, selected }) => {
  const { setNodes } = useReactFlow();
  const [editingIndex, setEditingIndex] = useState(-1);
  const [editDraft, setEditDraft] = useState(null);

  const updateNodeData = useCallback(
    (key, value) => {
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
    const assertions = data.config?.assertions || [];
    updateNodeData('assertions', [...assertions, assertion]);
  };

  const handleDeleteAssertion = (index) => {
    const assertions = data.config?.assertions || [];
    updateNodeData('assertions', assertions.filter((_, i) => i !== index));
  };

  return (
    <BaseNode
      title={data.label || 'Assertions'}
      icon={
        data.executionStatus === 'error'
          ? <XCircle className="w-4 h-4 text-red-600 dark:text-red-400" />
          : <BadgeCheck className="w-4 h-4 text-green-600 dark:text-green-400" />
      }
      status={data.executionStatus || 'idle'}
      selected={selected}
      nodeId={id}
      handleLeft={{ type: 'target' }}
      collapsible={true}
      defaultExpanded={false}
      headerBg={
        data.executionStatus === 'error'
          ? 'bg-red-50 dark:bg-red-900/60'
          : 'bg-green-50 dark:bg-green-900/60'
      }
      headerTextClass={
        data.executionStatus === 'error'
          ? 'text-red-800 dark:text-red-200'
          : 'text-green-800 dark:text-green-200'
      }
      titleExtra={
        data.assertionStats && (
          <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${
            data.assertionStats.failedCount > 0
              ? 'bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200'
              : 'bg-green-200 dark:bg-green-800 text-green-800 dark:text-green-200'
          }`}>
            {data.assertionStats.failedCount > 0
              ? `${data.assertionStats.failedCount}/${data.assertionStats.totalCount} failed`
              : `${data.assertionStats.passedCount}/${data.assertionStats.totalCount} passed`}
          </span>
        )
      }
      extraHandles={
        <>
          {/* Pass handle — positioned at upper-center-right */}
          <div className="group absolute" style={{ top: '50%', right: 0, transform: 'translateY(-20px)' }}>
            <Handle
              type="source"
              position={Position.Right}
              id="pass"
              className="!bg-green-500 dark:!bg-green-400 !w-2.5 !h-2.5 !border-2 !border-white dark:!border-gray-800"
              style={{ position: 'relative' }}
              title="Pass — all assertions passed"
            />
            <div
              className="absolute text-[9px] font-semibold text-green-600 dark:text-green-400 pointer-events-none select-none text-right opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ right: 14, top: -4, lineHeight: '1', whiteSpace: 'nowrap' }}
            >
              Pass
            </div>
          </div>

          {/* Fail handle — positioned at lower-center-right */}
          <div className="group absolute" style={{ top: '50%', right: 0, transform: 'translateY(20px)' }}>
            <Handle
              type="source"
              position={Position.Right}
              id="fail"
              className="!bg-red-500 dark:!bg-red-400 !w-2.5 !h-2.5 !border-2 !border-white dark:!border-gray-800"
              style={{ position: 'relative' }}
              title="Fail — one or more assertions failed"
            />
            <div
              className="absolute text-[9px] font-semibold text-red-600 dark:text-red-400 pointer-events-none select-none text-right opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ right: 14, top: -4, lineHeight: '1', whiteSpace: 'nowrap' }}
            >
              Fail
            </div>
          </div>
        </>
      }
      className={`min-w-[250px] ${data?.invalid ? 'ring-2 ring-red-500 animate-pulse' : ''}`}
    >
      {({ isExpanded }) => (
        <div className="p-2 space-y-1.5">
          <div className="text-[9px] text-text-muted dark:text-text-muted-dark">
            {data.config?.assertions?.length || 0} assertion(s)
          </div>

          {/* Execution Results Summary */}
          {data.executionStatus && data.assertionStats && (
            <div className={`mt-1 p-1.5 rounded text-[9px] ${
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
            <div className="space-y-2 pt-1 border-t border-border dark:border-border-dark">
              {/* Add Assertion Form */}
              <AssertionForm onAdd={handleAddAssertion} />

              {/* Assertions List */}
              {data.config?.assertions?.length > 0 ? (
                <div className="space-y-1.5">
                  {data.config.assertions.map((assertion, index) => (
                    <div
                      key={index}
                      className="p-1.5 bg-surface dark:bg-surface-dark-raised border border-border dark:border-border-dark rounded space-y-0.5"
                    >
                      {editingIndex === index ? (
                        <AssertionEditor
                          value={editDraft}
                          onChange={(next) => setEditDraft(next)}
                          onCancel={() => {
                            setEditingIndex(-1);
                            setEditDraft(null);
                          }}
                          onSave={() => {
                            const updated = (data.config?.assertions || []).map((a, i) =>
                              i === index ? { ...editDraft } : a
                            );
                            updateNodeData('assertions', updated);
                            setEditingIndex(-1);
                            setEditDraft(null);
                          }}
                        />
                      ) : (
                        <div className="flex items-start justify-between gap-1">
                          <div className="flex-1">
                            {data.assertionStats?.passed?.some(p => p.index === index) && (
                              <div className="mb-1 text-[8px] text-green-700 dark:text-green-300 font-semibold">
                                ✅ Passed
                              </div>
                            )}
                            {data.assertionStats?.failed?.some(f => f.index === index) && (
                              <div className="mb-1 text-[8px]">
                                <div className="text-red-700 dark:text-red-300 font-semibold">❌ Failed</div>
                                <div className="text-red-600 dark:text-red-400 mt-0.5">
                                  {data.assertionStats.failed.find(f => f.index === index)?.message}
                                </div>
                              </div>
                            )}
                            <div className="text-[8px]">
                              <div className="text-green-700 dark:text-green-300 font-semibold">
                                {assertion.source === 'prev' ? '{{prev.' :
                                 assertion.source === 'variables' ? '{{variables.' :
                                 assertion.source === 'status' ? 'status' :
                                 assertion.source === 'cookies' ? 'Cookie: ' : 'Header: '}
                                {assertion.source !== 'status' && assertion.path}
                                {(assertion.source === 'prev' || assertion.source === 'variables') && '}}'}
                              </div>
                              <div className="text-text-secondary dark:text-text-secondary-dark mt-0.5">
                                {assertion.operator}{' '}
                                <code className="bg-surface-raised dark:bg-surface-dark-raised px-0.5">
                                  {assertion.expectedValue}
                                </code>
                              </div>
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button
                              onClick={() => {
                                setEditingIndex(index);
                                setEditDraft({ ...assertion });
                              }}
                              className="px-1.5 py-0.5 bg-yellow-500 dark:bg-yellow-600 hover:bg-yellow-600 dark:hover:bg-yellow-700 text-white text-[8px] rounded nodrag transition-colors"
                              title="Edit assertion"
                            >
                              <Pencil className="w-3 h-3" />
                            </button>
                            <button
                              onClick={() => handleDeleteAssertion(index)}
                              className="px-1.5 py-0.5 bg-red-500 dark:bg-red-600 hover:bg-red-600 dark:hover:bg-red-700 text-white text-[8px] rounded nodrag transition-colors"
                              title="Delete assertion"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              ) : (
                <div className="text-[9px] text-text-muted dark:text-text-muted-dark italic py-2">
                  No assertions yet. Add one above.
                </div>
              )}

              {/* Info */}
              <div className="text-[8px] text-text-muted dark:text-text-muted-dark space-y-0.5 p-1 bg-blue-50 dark:bg-blue-900/20 rounded border border-blue-200 dark:border-blue-800">
                <p className="flex items-center gap-1">
                  <Info className="w-3 h-3 flex-shrink-0" />
                  <span><strong>Pass/Fail:</strong> Connect the green ✓ handle for all-pass, red ✗ for any-fail.</span>
                </p>
                <p>Use prev.* to reference previous node results.</p>
              </div>
            </div>
          )}
        </div>
      )}
    </BaseNode>
  );
};

export default memo(AssertionNode);
