import type { PanelTabsProps } from '../../types';

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
export function PanelTabs({
  tabs,
  activeTab,
  onTabChange,
}: PanelTabsProps) {
  return (
    <div
      className="flex items-center gap-0 border-b border-border dark:border-border-dark bg-surface-overlay dark:bg-surface-dark-overlay px-2 overflow-x-auto overflow-y-hidden"
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
              'flex items-center gap-1.5 px-3 py-2 text-xs font-medium border-b-2 transition-colors cursor-pointer',
              'focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]',
              'focus-visible:rounded-t',
              'min-w-0 shrink-0',
              isActive
                ? 'border-primary dark:border-cyan-400 text-primary dark:text-cyan-400'
                : 'border-transparent text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:border-border dark:hover:border-border-dark',
            ].join(' ')}
            role="tab"
            aria-selected={isActive}
            aria-controls={`panel-tab-${tab.key}`}
            tabIndex={isActive ? 0 : -1}
          >
            {Icon && <Icon className="w-3.5 h-3.5 flex-shrink-0" aria-hidden="true" />}
            <span className="min-w-0 truncate">{tab.label}</span>
          </button>
        );
      })}
    </div>
  );
}
