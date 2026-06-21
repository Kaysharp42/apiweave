import Tippy from '@tippyjs/react';
import type { IconButtonProps } from '../../types';

export function IconButton({
  children,
  tooltip,
  size = 'sm',
  variant = 'ghost',
  className = '',
  disabled = false,
  onClick,
  ...rest
}: IconButtonProps) {
  const sizeClass: Record<string, string> = {
    xs: 'h-6 w-6 text-xs',
    sm: 'h-8 w-8 text-sm',
    md: 'h-9 w-9 text-sm',
    lg: 'h-10 w-10 text-base',
  };

  const variantClass: Record<string, string> = {
    ghost: 'border border-transparent text-text-secondary dark:text-text-secondary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark',
    primary: 'border border-primary dark:border-primary-light bg-primary dark:bg-primary-light text-white dark:text-primary-dark hover:brightness-95 dark:hover:brightness-105',
    secondary: 'border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-primary dark:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay',
    outline: 'border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark hover:bg-text-primary dark:hover:bg-text-primary-dark hover:text-surface-raised dark:hover:text-surface-dark hover:border-text-primary dark:hover:border-text-primary-dark',
    success: 'border border-status-success/40 dark:border-[var(--aw-status-success)]/40 text-status-success dark:text-[var(--aw-status-success)] hover:bg-status-success/10 dark:hover:bg-[var(--aw-status-success)]/10',
    error: 'border border-status-error/40 dark:border-[var(--aw-status-error)]/40 text-status-error dark:text-[var(--aw-status-error)] hover:bg-status-error/10 dark:hover:bg-[var(--aw-status-error)]/10',
    warning: 'border border-status-warning/40 dark:border-[var(--aw-status-warning)]/40 text-status-warning dark:text-[var(--aw-status-warning)] hover:bg-status-warning/10 dark:hover:bg-[var(--aw-status-warning)]/10',
    info: 'border border-status-info/40 dark:border-[var(--aw-status-info)]/40 text-status-info dark:text-[var(--aw-status-info)] hover:bg-status-info/10 dark:hover:bg-[var(--aw-status-info)]/10',
  };

  const buttonClassName = [
    'inline-flex items-center justify-center rounded-sm transition-[background-color,color,border-color,filter] duration-[var(--aw-transition-fast)] ease-in-out',
    'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
    sizeClass[size] ?? sizeClass.sm,
    variantClass[variant] ?? variantClass.ghost,
    disabled ? 'cursor-not-allowed opacity-50 pointer-events-none' : 'cursor-pointer',
    className,
  ].filter(Boolean).join(' ');

  const button = (
    <button
      type="button"
      className={buttonClassName}
      disabled={disabled}
      onClick={onClick}
      aria-label={tooltip}
      {...rest}
    >
      {children}
    </button>
  );

  if (!tooltip) return button;

  return (
    <Tippy content={tooltip} placement="top" delay={[300, 0]}>
      {button}
    </Tippy>
  );
}
