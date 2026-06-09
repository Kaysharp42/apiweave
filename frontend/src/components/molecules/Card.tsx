import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { CardProps } from '../../types';

/**
 * Card — Reusable card with optional header, body, and footer.
 *
 * Used by: NodeModal config sections, settings panels,
 * and any grouped content that needs a visual container.
 *
 * @param title — optional card title
 * @param icon — optional icon component for the header
 * @param headerActions — optional actions rendered in the header
 * @param collapsible — show collapse/expand toggle
 * @param defaultExpanded — initial expanded state
 * @param children — card body content
 * @param className — extra classes on the outer wrapper
 */
export function Card({
  title,
  icon: Icon,
  headerActions,
  collapsible = false,
  defaultExpanded = true,
  children,
  className = '',
}: CardProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const hasHeader = title || headerActions || collapsible;

  return (
    <div className={`border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised shadow-raised overflow-hidden ${className}`}>
      {/* Header */}
      {hasHeader && (
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border dark:border-border-dark">
          <div className="flex items-center gap-2 min-w-0">
            {Icon && <Icon className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />}
            {title && (
              <h4 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark truncate">
                {title}
              </h4>
            )}
          </div>

          <div className="flex items-center gap-1.5 flex-shrink-0">
            {headerActions}

            {collapsible && (
              <button
                type="button"
                onClick={() => setIsExpanded(!isExpanded)}
                className="p-1 rounded text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-primary dark:focus-visible:outline-primary-light focus-visible:outline-offset-2"
                aria-expanded={isExpanded}
                aria-label={isExpanded ? 'Collapse section' : 'Expand section'}
              >
                {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
              </button>
            )}
          </div>
        </div>
      )}

      {/* Body */}
      {isExpanded && (
        <div className="p-4">
          {children}
        </div>
      )}
    </div>
  );
}
