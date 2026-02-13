import React, { useId, useRef, useEffect } from 'react';

/**
 * TextArea — DaisyUI `textarea` with optional auto-resize.
 *
 * @param {'xs'|'sm'|'md'|'lg'} size
 * @param {boolean} autoResize — grow height to fit content
 */
export default function TextArea({
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
}) {
  const autoId = useId();
  const id = externalId ?? autoId;
  const ref = useRef(null);

  const sizeClass = {
    xs: 'textarea-xs',
    sm: 'textarea-sm',
    md: '',
    lg: 'textarea-lg',
  }[size] ?? '';

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
          'textarea textarea-bordered w-full',
          sizeClass,
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
