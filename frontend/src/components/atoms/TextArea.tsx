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
    xs: 'textarea-xs',
    sm: 'textarea-sm',
    md: '',
    lg: 'textarea-lg',
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
        <label htmlFor={id} className="label">
          <span className="label-text text-text-primary dark:text-text-primary-dark">{label}</span>
        </label>
      )}
      <textarea
        ref={ref}
        id={id}
        value={value}
        onChange={onChange}
        className={[
          'textarea textarea-bordered w-full px-3 py-2',
          'bg-surface-raised dark:bg-surface-dark-raised',
          'text-text-primary dark:text-text-primary-dark',
          'border-border dark:border-border-dark',
          'placeholder:text-text-muted dark:placeholder:text-text-muted-dark',
          'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
          'transition-[border-color,box-shadow,outline] duration-[var(--aw-transition-fast)] ease-in-out',
          sizeClass[size] ?? '',
          error && 'textarea-error',
          autoResize && 'resize-none overflow-hidden',
          className,
        ]
          .filter(Boolean)
          .join(' ')}
        aria-invalid={!!error}
        {...rest}
      />
      {error && (
        <label className="label">
          <span className="label-text-alt text-error">{error}</span>
        </label>
      )}
      {!error && helperText && (
        <label className="label">
          <span className="label-text-alt text-text-secondary dark:text-text-secondary-dark">
            {helperText}
          </span>
        </label>
      )}
    </div>
  );
}
