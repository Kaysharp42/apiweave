import { useCallback } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '../atoms/Button';
import { IconButton } from '../atoms/IconButton';

const EMPTY_PAIRS: KeyValuePair[] = [];

export interface KeyValuePair {
  key: string;
  value: string;
}

export interface KeyValueEditorProps {
  pairs?: KeyValuePair[];
  onChange: (pairs: KeyValuePair[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  readOnly?: boolean;
  className?: string;
}

export function KeyValueEditor({
  pairs = EMPTY_PAIRS,
  onChange,
  keyPlaceholder = 'Key',
  valuePlaceholder = 'Value',
  readOnly = false,
  className = '',
}: KeyValueEditorProps) {
  const updatePair = useCallback(
    (index: number, field: 'key' | 'value', newValue: string) => {
      const updated = pairs.map((pair, i) =>
        i === index ? { ...pair, [field]: newValue } : pair,
      );
      onChange(updated);
    },
    [pairs, onChange],
  );

  const addPair = useCallback(() => {
    onChange([...pairs, { key: '', value: '' }]);
  }, [pairs, onChange]);

  const removePair = useCallback(
    (index: number) => {
      onChange(pairs.filter((_, i) => i !== index));
    },
    [pairs, onChange],
  );

  return (
    <div className={['w-full', className].filter(Boolean).join(' ')}>
      <div className="grid grid-cols-[1fr_1fr_auto] gap-1 mb-1">
        <span className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark px-2 py-1">
          {keyPlaceholder}
        </span>
        <span className="text-xs font-medium text-text-secondary dark:text-text-secondary-dark px-2 py-1">
          {valuePlaceholder}
        </span>
        <span className="w-8" />
      </div>

      {pairs.map((pair, index) => (
        <div key={pair.key} className="grid grid-cols-[1fr_1fr_auto] gap-1 mb-1">
          <input
            type="text"
            value={pair.key}
            onChange={(e) => updatePair(index, 'key', e.target.value)}
            placeholder={keyPlaceholder}
            readOnly={readOnly}
            aria-label={`${keyPlaceholder} ${index + 1}`}
            className="input input-bordered input-sm w-full"
          />
          <input
            type="text"
            value={pair.value}
            onChange={(e) => updatePair(index, 'value', e.target.value)}
            placeholder={valuePlaceholder}
            readOnly={readOnly}
            aria-label={`${valuePlaceholder} ${index + 1}`}
            className="input input-bordered input-sm w-full"
          />
          {!readOnly && (
            <IconButton
              tooltip="Remove row"
              size="xs"
              variant="ghost"
              onClick={() => removePair(index)}
              className="text-text-muted hover:text-status-error"
              aria-label={`Remove row ${index + 1}`}
            >
              <Trash2 className="w-4 h-4" />
            </IconButton>
          )}
        </div>
      ))}

      {!readOnly && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={addPair}
          className="gap-1 mt-1 text-text-secondary dark:text-text-secondary-dark"
        >
          <Plus className="w-4 h-4" />
          Add
        </Button>
      )}
    </div>
  );
}
