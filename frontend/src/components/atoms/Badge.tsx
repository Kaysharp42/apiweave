import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'primary' | 'secondary' | 'success' | 'error' | 'warning' | 'info' | 'ghost' | 'outline';
  size?: 'xs' | 'sm' | 'md' | 'lg';
  children?: React.ReactNode;
}

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: BadgeProps) {
  const variantClass: Record<string, string> = {
    default: 'badge-neutral',
    primary: 'badge-primary',
    secondary: 'badge-secondary',
    success: 'badge-success',
    error: 'badge-error',
    warning: 'badge-warning',
    info: 'badge-info',
    ghost: 'badge-ghost',
    outline: 'badge-outline',
  };

  const sizeClass: Record<string, string> = {
    xs: 'badge-xs',
    sm: 'badge-sm',
    md: '',
    lg: 'badge-lg',
  };

  return (
    <span
      className={['badge', variantClass[variant] ?? 'badge-neutral', sizeClass[size] ?? '', className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}
