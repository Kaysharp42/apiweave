import React, { useId } from 'react';

/**
 * Toggle — DaisyUI `toggle` for boolean settings.
 *
 * Replaces custom checkbox/switch patterns with a consistent toggle UI.
 *
 * @param {'primary'|'secondary'|'success'|'error'|'warning'} variant
 * @param {'xs'|'sm'|'md'|'lg'} size
 */
export default function Toggle({
  label,
  checked,
  onChange,
  variant = 'primary',
  size = 'sm',
  disabled = false,
  className = '',
  id: externalId,
  ...rest
}) {
  const autoId = useId();
  const id = externalId ?? autoId;

  const variantClass = {
    primary: 'toggle-primary',
    secondary: 'toggle-secondary',
    success: 'toggle-success',
    error: 'toggle-error',
    warning: 'toggle-warning',
  }[variant] ?? 'toggle-primary';

  const sizeClass = {
    xs: 'toggle-xs',
    sm: 'toggle-sm',
    md: '',
    lg: 'toggle-lg',
  }[size] ?? 'toggle-sm';

  return (
    <div className="form-control">
      <label htmlFor={id} className="label cursor-pointer gap-2">
        {label && (
          <span className="label-text text-text-primary dark:text-text-primary-dark">
            {label}
          </span>
        )}
        <input
          id={id}
          type="checkbox"
          className={['toggle', variantClass, sizeClass, className].filter(Boolean).join(' ')}
          checked={checked}
          onChange={onChange}
          disabled={disabled}
          {...rest}
        />
      </label>
    </div>
  );
}
