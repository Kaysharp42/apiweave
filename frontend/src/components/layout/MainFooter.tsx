import { Github, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Tippy from '@tippyjs/react';
import { IconButton } from '../atoms/IconButton';
import useNavigationStore from '../../stores/NavigationStore';

export function MainFooter() {
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const toggleNavBarCollapse = useNavigationStore((state) => state.toggleNavBarCollapse);

  return (
    <footer className="flex h-footer min-h-0 items-center justify-between border-t border-border bg-surface-raised px-4 font-mono text-xs text-text-secondary transition-colors dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-secondary-dark">
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-border bg-surface-overlay px-2 py-0.5 text-[10px] text-text-secondary dark:border-border-dark dark:bg-surface-dark-overlay dark:text-text-secondary-dark">v0.1.0</span>
      </div>

      <div className="flex items-center gap-1.5 text-text-secondary dark:text-text-secondary-dark">
        <span className="h-1.5 w-1.5 rounded-full bg-status-success dark:bg-status-success-dark" />
        <span>Ready</span>
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          tooltip={isNavBarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
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
        <Tippy content="View on GitHub" placement="top">
          <a
            href="https://github.com/Kaysharp42/apiweave"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:text-text-muted-dark dark:hover:bg-surface-dark-overlay dark:hover:text-text-primary-dark dark:focus-visible:outline-primary-light"
            aria-label="View on GitHub"
          >
            <Github className="w-3.5 h-3.5" />
          </a>
        </Tippy>
      </div>
    </footer>
  );
}
