import React, { useId } from 'react';
import { Search, X } from 'lucide-react';

/**
 * SearchInput — Compact search/filter input for sidebars and panels.
 *
 * Renders a DaisyUI-styled input with a search icon and optional clear button.
 * Designed for inline filtering (workflows, collections, etc.).
 *
 * @param {string}   value       — controlled value
 * @param {function} onChange    — called with new value string
 * @param {string}   placeholder — placeholder text
 * @param {'xs'|'sm'|'md'} size — input size
 */
export default function SearchInput({
  value = '',
  onChange,
  placeholder = 'Search…',
  size = 'sm',
  className = '',
  autoFocus = false,
  ...rest
}) {
  const id = useId();

  const sizeClass = {
    xs: 'input-xs',
    sm: 'input-sm',
    md: '',
  }[size] ?? 'input-sm';

  const iconSize = {
    xs: 'w-3 h-3',
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
  }[size] ?? 'w-3.5 h-3.5';

  return (
    <div className={['relative w-full', className].filter(Boolean).join(' ')}>
      {/* Search icon */}
      <Search
        className={[
          iconSize,
          'absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted dark:text-text-muted-dark pointer-events-none',
        ].join(' ')}
      />

      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange?.(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={[
          'input input-bordered w-full pl-8 pr-7',
          sizeClass,
          'bg-surface dark:bg-surface-dark',
          'text-text-primary dark:text-text-primary-dark',
          'placeholder:text-text-muted dark:placeholder:text-text-muted-dark',
          'focus:outline-none focus:border-primary dark:focus:border-primary-light',
        ].join(' ')}
        {...rest}
      />

      {/* Clear button */}
      {value && (
        <button
          type="button"
          onClick={() => onChange?.('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay text-text-muted dark:text-text-muted-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors"
          aria-label="Clear search"
        >
          <X className={iconSize} />
        </button>
      )}
    </div>
  );
}
