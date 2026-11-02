import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { Tooltip } from "../atoms/Tooltip";
import { IconButton } from "../atoms/IconButton";
import useNavigationStore from "../../stores/NavigationStore";

export function MainFooter() {
  const appVersion = import.meta.env.VITE_APP_VERSION ?? "0.0.0";
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const toggleNavBarCollapse = useNavigationStore(
    (state) => state.toggleNavBarCollapse,
  );

  return (
    <footer className="flex h-footer min-h-0 items-center justify-between border-t border-border bg-surface-raised px-4 font-mono text-xs text-text-secondary transition-colors dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-secondary-dark">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border bg-surface-overlay px-2 py-0.5 text-[10px] text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
          v{appVersion}
        </span>
      </div>

      <div className="flex items-center gap-1.5 text-text-secondary dark:text-text-secondary-dark">
        <span className="h-1.5 w-1.5 rounded-full bg-status-success dark:bg-status-success-dark" />
        <span>Ready</span>
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          tooltip={isNavBarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          size="xs"
          onClick={toggleNavBarCollapse}
          className="hidden rounded lg:inline-flex focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light"
        >
          {isNavBarCollapsed ? (
            <PanelLeftOpen className="w-3.5 h-3.5" />
          ) : (
            <PanelLeftClose className="w-3.5 h-3.5" />
          )}
        </IconButton>
        <Tooltip delay={0} content="View on GitHub" placement="top">
          <a
            href="https://github.com/Kaysharp42/apiweave"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:text-text-muted-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark dark:focus-visible:outline-primary-light"
            aria-label="View on GitHub"
          >
            <svg
              viewBox="0 0 16 16"
              fill="currentColor"
              aria-hidden="true"
              focusable="false"
              className="w-3.5 h-3.5"
            >
              <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.012 8.012 0 0 0 16 8c0-4.42-3.58-8-8-8z" />
            </svg>
          </a>
        </Tooltip>
      </div>
    </footer>
  );
}
