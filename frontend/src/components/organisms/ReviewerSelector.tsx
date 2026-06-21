import { useState, useRef, useEffect } from 'react';
import { X, User, Users } from 'lucide-react';
import { Badge } from '../atoms/Badge';
import type { ReviewerSelectorProps, ReviewerOption } from '../../types';

export function ReviewerSelector({
  value,
  onChange,
  options,
  label = 'Required reviewers',
  disabled = false,
  className = '',
}: ReviewerSelectorProps) {
  const [query, setQuery] = useState('');
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const selectedOptions = options.filter((opt) => value.includes(opt.id));
  const filteredOptions = options.filter(
    (opt) =>
      !value.includes(opt.id) &&
      opt.name.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function toggleOption(opt: ReviewerOption) {
    if (value.includes(opt.id)) {
      onChange(value.filter((id) => id !== opt.id));
    } else {
      onChange([...value, opt.id]);
    }
    setQuery('');
  }

  function removeOption(id: string) {
    onChange(value.filter((vid) => vid !== id));
  }

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      {label && (
        <label className="label py-1 px-0">
          <span className="label-text text-xs font-medium text-text-primary dark:text-text-primary-dark">
            {label}
          </span>
        </label>
      )}

      {/* Selected chips */}
      <div
        className={[
          'flex flex-wrap gap-1.5 p-2 min-h-[38px] rounded border',
          'border-border dark:border-border-dark',
          'bg-surface-raised dark:bg-surface-dark-raised',
          'cursor-text transition-colors',
          disabled ? 'opacity-50 cursor-not-allowed' : 'focus-within:ring-2 focus-within:ring-[var(--aw-primary)] focus-within:ring-offset-2',
        ].join(' ')}
        onClick={() => !disabled && setIsOpen(true)}
        role="combobox"
        aria-expanded={isOpen}
        aria-label={label}
      >
        {selectedOptions.length === 0 && !isOpen && (
          <span className="text-sm text-text-muted dark:text-text-muted-dark self-center px-1">
            Select reviewers...
          </span>
        )}
        {selectedOptions.map((opt) => (
          <Badge key={opt.id} variant={opt.type === 'team' ? 'primary' : 'default'} size="sm">
            {opt.type === 'team' ? (
              <Users className="w-3 h-3" aria-hidden="true" />
            ) : (
              <User className="w-3 h-3" aria-hidden="true" />
            )}
            {opt.name}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  removeOption(opt.id);
                }}
                className="ml-0.5 hover:opacity-70 transition-opacity cursor-pointer"
                aria-label={`Remove ${opt.name}`}
              >
                <X className="w-3 h-3" />
              </button>
            )}
          </Badge>
        ))}
        {isOpen && (
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="flex-1 min-w-[80px] bg-transparent text-sm text-text-primary dark:text-text-primary-dark outline-none placeholder:text-text-muted"
            placeholder={selectedOptions.length === 0 ? 'Search reviewers...' : ''}
            autoFocus
          />
        )}
      </div>

      {/* Dropdown */}
      {isOpen && !disabled && (
        <div className="absolute z-20 mt-1 w-full max-h-48 overflow-y-auto rounded border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised">
          {filteredOptions.length === 0 ? (
            <div className="px-3 py-2 text-sm text-text-muted dark:text-text-muted-dark">
              {query ? 'No matching reviewers' : 'All reviewers added'}
            </div>
          ) : (
            filteredOptions.map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => toggleOption(opt)}
                className="flex items-center gap-2 w-full px-3 py-2 text-sm text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer text-left"
              >
                {opt.type === 'team' ? (
                  <Users className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
                ) : (
                  <User className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
                )}
                <span className="truncate">{opt.name}</span>
                <span className="ml-auto text-xs text-text-muted dark:text-text-muted-dark">
                  {opt.type}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
