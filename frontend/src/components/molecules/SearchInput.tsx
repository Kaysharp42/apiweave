import { useId } from 'react';
import { Search, X } from 'lucide-react';
import type { SearchInputProps } from '../../types';

export function SearchInput({
  value = '',
  onChange,
  placeholder = 'Search…',
  size = 'sm',
  className = '',
  autoFocus = false,
  ...rest
}: SearchInputProps) {
  const id = useId();

  const sizeClass: Record<string, string> = {
    xs: 'input-xs',
    sm: 'input-sm',
    md: '',
  };

  const iconSize: Record<string, string> = {
    xs: 'w-3 h-3',
    sm: 'w-3.5 h-3.5',
    md: 'w-4 h-4',
  };

  return (
    <div className={['relative w-full', className].filter(Boolean).join(' ')}>
      <Search
        className={[
          iconSize[size] ?? 'w-3.5 h-3.5',
          'absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted dark:text-text-muted-dark pointer-events-none',
        ].join(' ')}
      />

      <input
        id={id}
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoFocus={autoFocus}
        className={[
          'input input-bordered w-full pl-8 pr-7',
          sizeClass[size] ?? 'input-sm',
          'bg-surface dark:bg-surface-dark',
          'text-text-primary dark:text-text-primary-dark',
          'placeholder:text-text-muted dark:placeholder:text-text-muted-dark',
          'focus:outline-none focus:border-primary dark:focus:border-primary-light',
          'focus-visible:ring-2 focus-visible:ring-primary dark:focus-visible:ring-primary-light focus-visible:ring-offset-2',
        ].join(' ')}
        {...rest}
      />

      {value && (
        <button
          type="button"
          onClick={() => onChange('')}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-0.5 rounded hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay text-text-muted dark:text-text-muted-dark hover:text-text-primary dark:hover:text-text-primary-dark transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:focus-visible:outline-primary-light focus-visible:outline-offset-2"
          aria-label="Clear search"
        >
          <X className={iconSize[size] ?? 'w-3.5 h-3.5'} />
        </button>
      )}
    </div>
  );
}
