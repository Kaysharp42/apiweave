import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';
import type { PanelProps } from '../../types';

/**
 * Panel — Reusable panel shell with header, body, footer, and collapse support.
 *
 * Used by: VariablesPanel, WorkflowSettingsPanel, DynamicFunctionsHelper,
 * right workspace panel, and all panel-based layouts.
 *
 * @param title — panel title
 * @param icon — optional icon component for the header
 * @param collapsible — show collapse/expand toggle
 * @param defaultExpanded — initial expanded state
 * @param headerActions — optional actions rendered in the header
 * @param children — panel body content
 * @param footer — optional footer content
 * @param className — extra classes on the outer wrapper
 */
export function Panel({
  title,
  icon: Icon,
  collapsible = false,
  defaultExpanded = true,
  headerActions,
  children,
  footer,
  className = '',
}: PanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div className={`flex flex-col border border-border dark:border-border-dark rounded-lg bg-surface-raised dark:bg-surface-dark-raised overflow-hidden ${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && <Icon className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />}
          <h3 className="text-sm font-semibold text-text-primary dark:text-text-primary-dark truncate">
            {title}
          </h3>
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {headerActions}

          {collapsible && (
            <button
              type="button"
              onClick={() => setIsExpanded(!isExpanded)}
              className="p-1 rounded text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? 'Collapse panel' : 'Expand panel'}
            >
              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="flex-1 min-h-0 overflow-y-auto">
          {children}
        </div>
      )}

      {/* Footer */}
      {footer && isExpanded && (
        <div className="px-4 py-2.5 border-t border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay">
          {footer}
        </div>
      )}
    </div>
  );
}
