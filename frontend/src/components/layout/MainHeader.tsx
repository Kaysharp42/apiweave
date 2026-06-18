import { useContext, useState } from 'react';
import { AppContext } from '../../App';
import EnvironmentManager from '../EnvironmentManager';
import { Moon, Sun, Folder, Save, Menu } from 'lucide-react';
import Tippy from '@tippyjs/react';
import { Button } from '../atoms/Button';
import { IconButton } from '../atoms/IconButton';
import type { AppContextType } from '../../types/AppContextType';
import { AccountMenu } from './AccountMenu';
import { OrgWorkspaceSwitcher } from '../organisms/OrgWorkspaceSwitcher';
import useNavigationStore from '../../stores/NavigationStore';

export function MainHeader() {
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } = useContext(AppContext) as AppContextType;
  const [showEnvManager, setShowEnvManager] = useState(false);
  const toggleMobileSidebar = useNavigationStore((state) => state.toggleMobileSidebar);

  return (
    <header className="navbar h-header min-h-0 w-full gap-3 border-b border-border bg-surface-raised px-4 text-text-primary transition-colors dark:border-border-dark dark:bg-surface-dark-raised dark:text-text-primary-dark">
      <div className="navbar-start min-w-0 flex-shrink-0 gap-3">
        <IconButton
          tooltip="Toggle sidebar"
          size="sm"
          onClick={toggleMobileSidebar}
          className="lg:hidden flex-shrink-0"
          aria-label="Toggle sidebar"
        >
          <Menu className="w-4 h-4" />
        </IconButton>

        <img
          src="/public/apiweave.png"
          alt="APIWeave Logo"
          className="h-7 w-7 rounded object-cover"
        />
        <h1 className="font-sans text-lg font-extrabold tracking-tight text-text-primary dark:text-text-primary-dark">
          APIWeave
        </h1>

        <div className="mx-2 h-5 w-px bg-border/50 dark:bg-border-dark/50" aria-hidden="true" />

        <OrgWorkspaceSwitcher />
      </div>

      <div className="navbar-center min-w-0 flex-1" />

      <div className="navbar-end min-w-0 flex-shrink gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowEnvManager(true)}
          title="Manage Environments"
          className="min-w-0 max-w-[11rem] flex-shrink focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-2 dark:focus-visible:outline-primary-light"
          icon={<Folder className="w-4 h-4 flex-shrink-0" />}
        >
          <span className="hidden truncate text-xs font-medium sm:inline">Environments</span>
        </Button>

      <Tippy content={autoSaveEnabled ? 'Auto-save enabled' : 'Auto-save disabled'} placement="bottom">
          <button
            type="button"
            onClick={() => setAutoSaveEnabled(!autoSaveEnabled)}
            aria-label={autoSaveEnabled ? 'Disable auto-save' : 'Enable auto-save'}
            className={`inline-flex items-center justify-center w-9 h-9 rounded-sm border transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-2 ${
              autoSaveEnabled
                ? 'border-status-success/40 bg-status-success/10 text-status-success hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay'
                : 'border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-muted dark:text-text-muted-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay'
            }`}
          >
            <Save className="w-4 h-4" />
          </button>
        </Tippy>

      <Tippy content={darkMode ? 'Switch to Light mode' : 'Switch to Dark mode'} placement="bottom">
          <button
            type="button"
            onClick={() => setDarkMode(!darkMode)}
            aria-label={darkMode ? 'Switch to light mode' : 'Switch to dark mode'}
            className="inline-flex items-center justify-center w-9 h-9 rounded-sm border border-border dark:border-border-dark bg-surface-raised dark:bg-surface-dark-raised text-text-secondary dark:text-text-secondary-dark hover:text-text-primary dark:hover:text-text-primary-dark hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-2"
          >
            {darkMode ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
          </button>
        </Tippy>

        <AccountMenu />
      </div>

      {showEnvManager && (
        <EnvironmentManager open={true} onClose={() => setShowEnvManager(false)} />
      )}
    </header>
  );
}
