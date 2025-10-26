import React, { useEffect, useRef, useState } from 'react';

const AssertionEditor = ({
  value,
  onChange,
  onCancel,
  onSave
}) => {
  const local = value || { source: 'prev', path: '', operator: 'equals', expectedValue: '' };
  const { source, path, operator, expectedValue } = local;
  const inputRef = useRef(null);
  const [errors, setErrors] = useState({ path: '', expectedValue: '' });

  useEffect(() => {
    // focus first input when mounted
    if (inputRef.current) inputRef.current.focus();
  }, []);

  const validate = () => {
    const next = { path: '', expectedValue: '' };
    if (source !== 'status') {
      if (['exists', 'notExists'].includes(operator)) {
        if (!path || !path.trim()) next.path = 'Path is required';
      } else {
        if (!path || !path.trim()) next.path = 'Path is required';
        if (!expectedValue || !expectedValue.toString().trim()) next.expectedValue = 'Expected value is required';
      }
    }
    setErrors(next);
    return !next.path && !next.expectedValue;
  };

  const handleKey = (e) => {
    if (e.key === 'Escape') onCancel?.();
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      if (validate()) onSave?.();
    }
  };

  const handleSave = () => {
    if (validate()) onSave?.();
  };

  return (
    <div className="space-y-2" onKeyDown={handleKey}>
      <div className="grid grid-cols-2 gap-2">
        <select
          value={source}
          onChange={(e) => onChange({ ...local, source: e.target.value })}
          className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded"
        >
          <option value="prev">prev</option>
          <option value="variables">variables</option>
          <option value="status">status</option>
          <option value="cookies">cookies</option>
          <option value="headers">headers</option>
        </select>
        <div>
          <input
            ref={inputRef}
            type="text"
            value={path}
            onChange={(e) => onChange({ ...local, path: e.target.value })}
            placeholder="path or name"
            className={`w-full px-2 py-1 text-sm border rounded font-mono ${errors.path ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'}`}
          />
          {errors.path && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{errors.path}</div>}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <select
          value={operator}
          onChange={(e) => onChange({ ...local, operator: e.target.value })}
          className="w-full px-2 py-1 text-sm border border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200 rounded"
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

        {!['exists', 'notExists'].includes(operator) ? (
          <div>
            <input
              type="text"
              value={expectedValue}
              onChange={(e) => onChange({ ...local, expectedValue: e.target.value })}
              placeholder="expected value"
              className={`w-full px-2 py-1 text-sm border rounded font-mono ${errors.expectedValue ? 'border-red-500 dark:border-red-400' : 'border-gray-300 dark:border-gray-600 dark:bg-gray-700 dark:text-gray-200'}`}
            />
            {errors.expectedValue && <div className="text-[11px] text-red-600 dark:text-red-400 mt-1">{errors.expectedValue}</div>}
          </div>
        ) : (
          <div className="text-sm text-gray-500 dark:text-gray-400 flex items-center px-2">No value required</div>
        )}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="px-3 py-1 bg-gray-200 dark:bg-gray-600 text-gray-700 dark:text-gray-200 rounded text-sm"
        >
          Cancel
        </button>
        <button
          onClick={handleSave}
          className="px-3 py-1 bg-cyan-600 dark:bg-cyan-700 text-white rounded text-sm"
        >
          Save
        </button>
      </div>
    </div>
  );
};

export default AssertionEditor;
