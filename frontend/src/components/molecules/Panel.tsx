import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { PanelProps } from "../../types";

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
  className = "",
}: PanelProps) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  return (
    <div
      className={`flex h-full flex-col rounded-sm border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised ${className}`}
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border bg-surface-overlay px-4 py-2.5 dark:border-border-dark dark:bg-surface-dark-overlay">
        <div className="flex items-center gap-2 min-w-0">
          {Icon && (
            <Icon className="w-4 h-4 text-text-secondary dark:text-text-secondary-dark flex-shrink-0" />
          )}
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
              className="cursor-pointer rounded-sm p-1 text-text-secondary transition-colors hover:bg-surface-raised hover:text-text-primary focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] dark:text-text-secondary-dark dark:hover:bg-surface-dark-raised dark:hover:text-text-primary-dark"
              aria-expanded={isExpanded}
              aria-label={isExpanded ? "Collapse panel" : "Expand panel"}
            >
              {isExpanded ? (
                <ChevronUp className="w-4 h-4" />
              ) : (
                <ChevronDown className="w-4 h-4" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Body */}
      {isExpanded && (
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      )}

      {/* Footer */}
      {footer && isExpanded && (
        <div className="border-t border-border bg-surface-overlay px-4 py-2.5 dark:border-border-dark dark:bg-surface-dark-overlay">
          {footer}
        </div>
      )}
    </div>
  );
}
