import React from 'react';
import { Loader2 } from 'lucide-react';
import type { ButtonProps } from '../../types';

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({
  children,
  variant = 'primary',
  intent = 'default',
  size = 'md',
  loading = false,
  disabled = false,
  fullWidth = false,
  icon,
  className = '',
  type = 'button',
  onClick,
  ...rest
}, ref) => {
  const baseClasses = [
    'inline-flex items-center justify-center gap-2 whitespace-nowrap rounded',
    'transition-[box-shadow,background-color,color,filter] duration-[var(--aw-transition-fast)] ease-in-out',
    'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
  ].join(' ');

  const sizeClasses: Record<NonNullable<ButtonProps['size']>, string> = {
    xs: 'px-2 py-1 text-xs',
    sm: 'px-3 py-1.5 text-sm',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
  };

  const getVariantClasses = (): string => {
    if (variant === 'primary') {
      const intentMap: Record<NonNullable<ButtonProps['intent']>, string> = {
        default: 'bg-[var(--aw-primary)] text-white dark:text-primary-dark border border-[var(--aw-primary)] hover:bg-[var(--aw-primary-hover)] shadow-raised hover:shadow-overlay',
        success: 'bg-status-success dark:bg-[var(--aw-status-success)] text-white dark:text-green-950 border border-status-success dark:border-[var(--aw-status-success)] hover:brightness-95 dark:hover:brightness-105 shadow-raised hover:shadow-overlay',
        error: 'bg-status-error dark:bg-[var(--aw-status-error)] text-white dark:text-red-950 border border-status-error dark:border-[var(--aw-status-error)] hover:brightness-95 dark:hover:brightness-105 shadow-raised hover:shadow-overlay',
        warning: 'bg-status-warning dark:bg-[var(--aw-status-warning)] text-white dark:text-amber-950 border border-status-warning dark:border-[var(--aw-status-warning)] hover:brightness-95 dark:hover:brightness-105 shadow-raised hover:shadow-overlay',
        info: 'bg-status-info dark:bg-[var(--aw-status-info)] text-white dark:text-blue-950 border border-status-info dark:border-[var(--aw-status-info)] hover:brightness-95 dark:hover:brightness-105 shadow-raised hover:shadow-overlay',
      };
      return intentMap[intent];
    }

    if (variant === 'secondary') {
      const intentMap: Record<NonNullable<ButtonProps['intent']>, string> = {
        default: 'bg-primary/5 dark:bg-primary-light/10 text-primary dark:text-primary-light border border-primary dark:border-primary-light hover:bg-primary/10 dark:hover:bg-primary-light/20',
        success: 'bg-status-success/5 dark:bg-[var(--aw-status-success)]/10 text-status-success dark:text-[var(--aw-status-success)] border border-status-success dark:border-[var(--aw-status-success)] hover:bg-status-success/10 dark:hover:bg-[var(--aw-status-success)]/20',
        error: 'bg-status-error/5 dark:bg-[var(--aw-status-error)]/10 text-status-error dark:text-[var(--aw-status-error)] border border-status-error dark:border-[var(--aw-status-error)] hover:bg-status-error/10 dark:hover:bg-[var(--aw-status-error)]/20',
        warning: 'bg-status-warning/5 dark:bg-[var(--aw-status-warning)]/10 text-status-warning dark:text-[var(--aw-status-warning)] border border-status-warning dark:border-[var(--aw-status-warning)] hover:bg-status-warning/10 dark:hover:bg-[var(--aw-status-warning)]/20',
        info: 'bg-status-info/5 dark:bg-[var(--aw-status-info)]/10 text-status-info dark:text-[var(--aw-status-info)] border border-status-info dark:border-[var(--aw-status-info)] hover:bg-status-info/10 dark:hover:bg-[var(--aw-status-info)]/20',
      };
      return intentMap[intent];
    }

    if (variant === 'ghost') {
      const intentMap: Record<NonNullable<ButtonProps['intent']>, string> = {
        default: 'text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay',
        success: 'text-status-success dark:text-[var(--aw-status-success)] hover:bg-status-success/5 dark:hover:bg-[var(--aw-status-success)]/10',
        error: 'text-status-error dark:text-[var(--aw-status-error)] hover:bg-status-error/5 dark:hover:bg-[var(--aw-status-error)]/10',
        warning: 'text-status-warning dark:text-[var(--aw-status-warning)] hover:bg-status-warning/5 dark:hover:bg-[var(--aw-status-warning)]/10',
        info: 'text-status-info dark:text-[var(--aw-status-info)] hover:bg-status-info/5 dark:hover:bg-[var(--aw-status-info)]/10',
      };
      return intentMap[intent];
    }

    return '';
  };

  const variantClasses = getVariantClasses();
  const stateClasses = (disabled || loading)
    ? 'opacity-50 cursor-not-allowed pointer-events-none'
    : 'cursor-pointer';

  return (
    <button
      ref={ref}
      type={type}
      className={[
        baseClasses,
        sizeClasses[size],
        variantClasses,
        stateClasses,
        fullWidth && 'w-full',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={disabled || loading}
      aria-busy={loading}
      onClick={onClick}
      {...rest}
    >
      {loading && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
      {icon && !loading && icon}
      {children}
    </button>
  );
});

Button.displayName = 'Button';
