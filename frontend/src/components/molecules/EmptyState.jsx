import React from 'react';
import { Inbox } from 'lucide-react';

/**
 * EmptyState — Reusable empty state with icon, title, description, and optional CTA.
 *
 * Inspired by FlowTest's EmptyWorkSpaceContent — displays when there's
 * no data to show (no workflows, no collections, no results, etc.).
 *
 * @param {React.ReactNode} icon — override the default icon
 * @param {string} title
 * @param {string} description
 * @param {React.ReactNode} action — optional CTA button or element
 */
export default function EmptyState({
  icon,
  title = 'Nothing here yet',
  description,
  action,
  className = '',
}) {
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
