import { useId } from 'react';
import type { InputProps } from '../../types';

export function Input({
  label,
  error,
  helperText,
  size = 'md',
  className = '',
  id: externalId,
  ...rest
}: InputProps) {
  const autoId = useId();
  const id = externalId ?? autoId;

  const sizeClass: Record<string, string> = {
    xs: 'input-xs',
    sm: 'input-sm',
    md: '',
    lg: 'input-lg',
  };

  return (
    <div className="form-control w-full">
      {label && (
        <label htmlFor={id} className="label">
          <span className="label-text text-text-primary dark:text-text-primary-dark">{label}</span>
        </label>
      )}
      <input
        id={id}
        className={[
          'input input-bordered w-full px-3',
          'bg-surface-raised dark:bg-surface-dark-raised',
          'text-text-primary dark:text-text-primary-dark',
          'border-border dark:border-border-dark',
          'placeholder:text-text-muted dark:placeholder:text-text-muted-dark',
          'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
          'transition-[border-color,box-shadow,outline] duration-[var(--aw-transition-fast)] ease-in-out',
          sizeClass[size] ?? '',
          error && 'input-error',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={!!error}
        aria-describedby={error ? `${id}-error` : helperText ? `${id}-helper` : undefined}
        {...rest}
      />
      {error && (
        <label className="label" id={`${id}-error`}>
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
      {!error && helperText && (
        <label className="label" id={`${id}-helper`}>
          <span className="label-text-alt text-text-secondary dark:text-text-secondary-dark">
            {helperText}
          </span>
        </label>
      )}
    </div>
  );
}
