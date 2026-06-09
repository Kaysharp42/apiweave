import type { BadgeProps } from '../../types';

export function Badge({
  children,
  variant = 'default',
  size = 'md',
  className = '',
  ...rest
}: BadgeProps) {
  const variantClass: Record<string, string> = {
    default: 'bg-surface-overlay dark:bg-surface-dark-overlay text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark',
    primary: 'bg-[var(--aw-primary)]/10 dark:bg-[var(--aw-primary)]/20 text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)] border border-[var(--aw-primary)]/20 dark:border-[var(--aw-primary-light)]/30',
    secondary: 'bg-primary/5 dark:bg-primary-light/10 text-primary dark:text-primary-light border border-primary/20 dark:border-primary-light/20',
    success: 'bg-status-success/10 dark:bg-[var(--aw-status-success)]/20 text-status-success dark:text-[var(--aw-status-success)] border border-status-success/20 dark:border-[var(--aw-status-success)]/30',
    error: 'bg-status-error/10 dark:bg-[var(--aw-status-error)]/20 text-status-error dark:text-[var(--aw-status-error)] border border-status-error/20 dark:border-[var(--aw-status-error)]/30',
    warning: 'bg-status-warning/10 dark:bg-[var(--aw-status-warning)]/20 text-status-warning dark:text-[var(--aw-status-warning)] border border-status-warning/20 dark:border-[var(--aw-status-warning)]/30',
    info: 'bg-status-info/10 dark:bg-[var(--aw-status-info)]/20 text-status-info dark:text-[var(--aw-status-info)] border border-status-info/20 dark:border-[var(--aw-status-info)]/30',
    ghost: 'text-text-secondary dark:text-text-secondary-dark',
    outline: 'bg-transparent text-text-primary dark:text-text-primary-dark border border-border dark:border-border-dark',
  };

  const sizeClass: Record<string, string> = {
    xs: 'text-xxs px-1.5 py-0.5',
    sm: 'text-xs px-2 py-0.5',
    md: 'text-xs px-2.5 py-1',
    lg: 'text-sm px-3 py-1',
  };

  return (
    <span
      className={[
        'inline-flex items-center gap-1 rounded font-medium whitespace-nowrap',
        variantClass[variant] ?? variantClass.default,
        sizeClass[size] ?? sizeClass.md,
        className,
      ].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </span>
  );
}
