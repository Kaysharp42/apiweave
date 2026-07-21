import type { PanelTabsProps } from "../../types";

/**
 * PanelTabs — Reusable tab bar for panels.
 *
 * Used by: Workspace right panel, NodeModal config panels,
 * and any panel that needs tabbed navigation.
 *
 * @param tabs — array of { key, icon, label }
 * @param activeTab — currently active tab key
 * @param onTabChange — callback with new tab key
 */
export function PanelTabs({ tabs, activeTab, onTabChange }: PanelTabsProps) {
  return (
    <div
      className="flex items-center gap-0 overflow-x-auto overflow-y-hidden border-b border-border bg-surface-overlay px-2 dark:border-border-dark dark:bg-surface-dark-overlay"
      role="tablist"
      aria-label="Panel tabs"
    >
      {tabs.map((tab) => {
        const isActive = tab.key === activeTab;
        const Icon = tab.icon;

        return (
          <button
            key={tab.key}
            type="button"
            onClick={() => onTabChange(tab.key)}
            className={[
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-xs font-medium transition-colors cursor-pointer",
              "focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
              "focus-visible:rounded-sm",
              "min-w-0 shrink-0",
              isActive
                ? "border-primary text-primary dark:border-primary-light dark:text-primary-light"
                : "border-transparent text-text-secondary hover:border-border hover:text-text-primary dark:text-text-secondary-dark dark:hover:border-border-dark dark:hover:text-text-primary-dark",
            ].join(" ")}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-tab-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
          >
            {Icon && (
              <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />
            )}
            <span className="min-w-0 truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
