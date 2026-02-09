import React, { useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';

/**
 * KeyValueEditor — Reusable key-value pair table.
 *
 * Used by: headers editor, environment variables, extractors, query params.
 *
 * @param {Array<{key: string, value: string}>} pairs — current key-value pairs
 * @param {function} onChange — called with updated pairs array
 * @param {string} keyPlaceholder
 * @param {string} valuePlaceholder
 * @param {boolean} readOnly
 */
export default function KeyValueEditor({
  pairs = [],
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  readOnly = false,
  className = '',
}) {
  const updatePair = useCallback(
    (index, field, newValue) => {
      const updated = pairs.map((pair, i) =>
        i === index ? { ...pair, [field]: newValue } : pair,
      );
      onChange?.(updated);
    },
    [pairs, onChange],
  );

  const addPair = useCallback(() => {
    onChange?.([...pairs, { key: '', value: '' }]);
  }, [pairs, onChange]);

  const removePair = useCallback(
    (index) => {
      onChange?.(pairs.filter((_, i) => i !== index));
    },
    [pairs, onChange],
  );

  return (
    <div className={['w-full', className].filter(Boolean).join(' ')}>
      {/* Header */}
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1 mb-1">
        <span className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark px-2 py-1">
          {keyPlaceholder}
        </span>
        <span className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark px-2 py-1">
          {valuePlaceholder}
        </span>
        <span className="w-8" />
      </div>

      {/* Rows */}
      {pairs.map((pair, index) => (
        <div key={index} className="grid grid-cols-[1fr_1fr_auto] gap-1 mb-1">
          <input
            type="text"
            value={pair.key}
            onChange={(e) => updatePair(index, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            readOnly={readOnly}
            className="input input-bordered input-sm w-full"
          />
          <input
            type="text"
            value={pair.value}
            onChange={(e) => updatePair(index, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            readOnly={readOnly}
            className="input input-bordered input-sm w-full"
          />
          {!readOnly && (
            <button
              type="button"
              className="btn btn-ghost btn-sm btn-square text-text-muted hover:text-status-error"
              onClick={() => removePair(index)}
              aria-label="Remove row"
            >
              <Trash2 className="w-4 h-4" />
            </button>
          )}
        </div>
      ))}

      {/* Add row */}
      {!readOnly && (
        <button
          type="button"
          className="btn btn-ghost btn-sm gap-1 mt-1 text-text-secondary dark:text-text-secondary-dark"
          onClick={addPair}
        >
          <Plus className="w-4 h-4" />
          Add
        </button>
      )}
    </div>
  );
}
