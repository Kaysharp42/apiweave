import type { SidebarActionProps } from '../../../types';

/**
 * Reusable action button for sidebar items (export, delete, etc.).
 * Visible on hover/focus-within, hidden by default via opacity transition.
 */
export function SidebarAction({
  icon: Icon,
  label,
  onClick,
  destructive = false,
  className = '',
}: SidebarActionProps) {
  const baseClasses = [
    'p-1.5 rounded-md transition-all',
    'opacity-40 group-hover:opacity-100 group-focus-within:opacity-100',
    'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
    'cursor-pointer',
  ].join(' ');

  const variantClasses = destructive
    ? 'text-[var(--aw-status-error)]/80 hover:bg-[var(--aw-status-error)]/10 hover:text-[var(--aw-status-error)]'
    : 'text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay hover:text-text-primary dark:hover:text-text-primary-dark';

  return (
    <button
      type="button"
      onClick={onClick}
      className={[baseClasses, variantClasses, className].filter(Boolean).join(' ')}
      title={label}
      aria-label={label}
    >
      <Icon className="w-3.5 h-3.5" />
    </button>
  );
}