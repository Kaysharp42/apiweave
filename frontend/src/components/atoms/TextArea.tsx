import { useId, useRef, useEffect } from 'react';
import type { TextAreaProps } from '../../types';

export function TextArea({
  label,
  error,
  helperText,
  size = 'md',
  autoResize = false,
  className = '',
  id: externalId,
  value,
  onChange,
  ...rest
}: TextAreaProps) {
  const autoId = useId();
  const id = externalId ?? autoId;
  const ref = useRef<HTMLTextAreaElement>(null);

  const sizeClass: Record<string, string> = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-2.5 py-1.5 text-sm',
    md: 'px-3 py-2 text-sm',
    lg: 'px-3.5 py-2.5 text-base',
  };

  useEffect(() => {
    if (autoResize && ref.current) {
      ref.current.style.height = 'auto';
      ref.current.style.height = `${ref.current.scrollHeight}px`;
    }
  }, [value, autoResize]);

  return (
    <div className="form-control w-full">
      {label && (
        <label htmlFor={id} className="label px-0 py-1">
          <span className="label-text text-sm font-medium text-text-primary dark:text-text-primary-dark">{label}</span>
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        value={value}
        onChange={onChange}
        className={[
          'w-full rounded-sm border',
          'bg-surface-raised dark:bg-surface-dark-raised',
          'text-text-primary dark:text-text-primary-dark',
          'border-border dark:border-border-dark',
          'placeholder:text-text-muted dark:placeholder:text-text-muted-dark',
          'focus:border-primary dark:focus:border-primary-light',
          'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
          'transition-[border-color,outline,background-color] duration-[var(--aw-transition-fast)] ease-in-out',
          sizeClass[size] ?? '',
          error && 'border-status-error dark:border-[var(--aw-status-error)]',
          autoResize && 'resize-none overflow-hidden',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={!!error}
        {...rest}
      />
      {error && (
        <label className="label px-0 py-1">
          <span className="label-text-alt text-xs text-status-error dark:text-[var(--aw-status-error)]">{error}</span>
        </label>
      )}
      {!error && helperText && (
        <label className="label px-0 py-1">
          <span className="label-text-alt text-xs text-text-muted dark:text-text-muted-dark">
            {helperText}
          </span>
        </label>
      )}
    </div>
  );
}
