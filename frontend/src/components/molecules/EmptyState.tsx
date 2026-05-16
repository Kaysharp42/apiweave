import { Inbox } from 'lucide-react';
import type { EmptyStateProps } from '../../types';

export function EmptyState({
  icon,
  title = 'Nothing here yet',
  description,
  action,
  className = '',
}: EmptyStateProps) {
  const defaultIcon = <Inbox className="w-12 h-12 text-text-muted dark:text-text-muted-dark" strokeWidth={1.5} />;

  return (
    <div
      className={[
        'flex flex-col items-center justify-center gap-3 py-12 px-6 text-center',
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex items-center justify-center">
        {icon ?? defaultIcon}
      </div>
      <h3 className="text-lg font-semibold font-display text-text-primary dark:text-text-primary-dark">
        {title}
      </h3>
      {description && (
        <p className="max-w-sm text-sm text-text-secondary dark:text-text-secondary-dark">
          {description}
        </p>
      )}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
