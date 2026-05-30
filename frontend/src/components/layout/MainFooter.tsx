import { Github, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Tippy from '@tippyjs/react';
// @ts-expect-error CSS import without types
import 'tippy.js/dist/tippy.css';
import { IconButton } from '../atoms/IconButton';
import useNavigationStore from '../../stores/NavigationStore';

export function MainFooter() {
  const isNavBarCollapsed = useNavigationStore((state) => state.collapseNavBar);
  const toggleNavBarCollapse = useNavigationStore((state) => state.toggleNavBarCollapse);

  return (
    <footer className="flex items-center justify-between px-4 h-footer min-h-0 bg-surface-raised dark:bg-surface-dark-raised border-t border-border dark:border-border-dark text-xs transition-colors">
      <div className="flex items-center gap-2">
        <span className="badge badge-ghost badge-xs font-mono">v0.1.0</span>
      </div>

      <div className="flex items-center gap-1.5 text-text-secondary dark:text-text-secondary-dark">
        <span className="w-1.5 h-1.5 rounded-full bg-status-success" />
        <span>Ready</span>
      </div>

      <div className="flex items-center gap-1">
        <IconButton
          tooltip={isNavBarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          size="xs"
          onClick={toggleNavBarCollapse}
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
            className="btn btn-ghost btn-xs btn-square text-text-muted dark:text-text-muted-dark"
          >
            <Github className="w-3.5 h-3.5" />
          </a>
        </Tippy>
      </div>
    </footer>
  );
}
