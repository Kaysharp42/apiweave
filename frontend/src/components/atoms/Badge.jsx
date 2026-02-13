import React from 'react';

/**
 * Badge — DaisyUI `badge` with semantic color variants.
 *
 * @param {'default'|'primary'|'secondary'|'success'|'error'|'warning'|'info'|'ghost'|'outline'} variant
 * @param {'xs'|'sm'|'md'|'lg'} size
 */
export default function Badge({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}) {
  const variantClass = {
    default: 'badge-neutral',
    primary: 'badge-primary',
    secondary: 'badge-secondary',
    success: 'badge-success',
    error: 'badge-error',
    warning: 'badge-warning',
    info: 'badge-info',
    ghost: 'badge-ghost',
    outline: 'badge-outline',
  }[variant] ?? 'badge-neutral';

  const sizeClass = {
    xs: 'badge-xs',
    sm: 'badge-sm',
    md: '',
    lg: 'badge-lg',
  }[size] ?? '';

  return (
    <span
      className={['badge', variantClass, sizeClass, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}
