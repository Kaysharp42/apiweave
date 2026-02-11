import React from 'react';

/**
 * Button — DaisyUI `btn` with intent variants, sizes, and loading state.
 *
 * Replaces scattered button patterns with a single, design-system-driven component.
 *
 * @param {'primary'|'secondary'|'success'|'error'|'warning'|'ghost'|'outline'} variant
 * @param {'xs'|'sm'|'md'|'lg'} size
 * @param {boolean} loading
 * @param {boolean} disabled
 * @param {boolean} fullWidth
 * @param {string} className  — escape hatch for one-off overrides
 */
export default function Button({
  children,
  variant = 'primary',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  className = '',
  type = 'button',
  onClick,
  ...rest
}) {
  const variantClass = {
    primary: 'btn-primary',
    secondary: 'btn-secondary',
    success: 'btn-success',
    error: 'btn-error',
    warning: 'btn-warning',
    ghost: 'btn-ghost',
    outline: 'btn-outline',
  }[variant] ?? 'btn-primary';

  const sizeClass = {
    xs: 'btn-xs',
    sm: 'btn-sm',
    md: '',
    lg: 'btn-lg',
  }[size] ?? '';

  return (
    <button
      type={type}
      className={[
        'btn gap-1.5',
        variantClass,
        sizeClass,
        fullWidth && 'btn-block',
        loading && 'loading',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      onClick={onClick}
      {...rest}
    >
      {loading && <span className="loading loading-spinner loading-sm" />}
      {children}
    </button>
  );
}
