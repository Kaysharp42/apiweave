import { useContext, useState } from 'react';
import { AppContext } from '../../App';
import EnvironmentManager from '../EnvironmentManager';
import { Moon, Sun, Folder, Save, Menu } from 'lucide-react';
import Tippy from '@tippyjs/react';
// @ts-expect-error CSS import without types
import 'tippy.js/dist/tippy.css';
import { Button } from '../atoms/Button';
import { IconButton } from '../atoms/IconButton';
import { IconSwitch } from '../atoms/IconSwitch';
import type { AppContextType } from '../../types/AppContextType';
import { AccountMenu } from './AccountMenu';
import { OrgWorkspaceSwitcher } from '../organisms/OrgWorkspaceSwitcher';
import useNavigationStore from '../../stores/NavigationStore';

export function MainHeader() {
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } = useContext(AppContext) as AppContextType;
  const [showEnvManager, setShowEnvManager] = useState(false);
  const toggleMobileSidebar = useNavigationStore((state) => state.toggleMobileSidebar);

  return (
    <header className="navbar h-header min-h-0 w-full gap-3 px-4 bg-surface-raised dark:bg-surface-dark-raised border-b border-border dark:border-border-dark transition-colors">
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
          className="h-7 w-7 rounded-lg shadow-sm object-cover"
        />
        <h1 className="text-lg font-display font-bold tracking-tight text-[var(--aw-primary)]">
          APIWeave
        </h1>

        <div className="mx-2 h-5 w-px bg-border/50 dark:bg-border-dark/50" aria-hidden="true" />

        <OrgWorkspaceSwitcher />
      </div>

      <div className="navbar-center min-w-0 flex-1" />

      <div className="navbar-end min-w-0 flex-shrink gap-2">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowEnvManager(true)}
          title="Manage Environments"
          className="min-w-0 max-w-[11rem] flex-shrink focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-2"
          icon={<Folder className="w-4 h-4 flex-shrink-0" />}
        >
          <span className="hidden truncate text-xs font-medium sm:inline">Environments</span>
        </Button>

        <Tippy content={autoSaveEnabled ? 'Auto-save enabled' : 'Auto-save disabled'} placement="bottom">
          <div className="flex flex-shrink-0 items-center rounded px-1">
            <IconSwitch
              checked={autoSaveEnabled}
              onCheckedChange={setAutoSaveEnabled}
              checkedIcon={<Save className="h-3.5 w-3.5" />}
              uncheckedIcon={<Save className="h-3.5 w-3.5" />}
              checkedLabel="Disable auto-save"
              uncheckedLabel="Enable auto-save"
              intent="success"
            />
          </div>
        </Tippy>

        <Tippy content={darkMode ? 'Switch to Light mode' : 'Switch to Dark mode'} placement="bottom">
          <div className="flex flex-shrink-0 items-center rounded px-1">
            <IconSwitch
              checked={darkMode}
              onCheckedChange={setDarkMode}
              checkedIcon={<Moon className="h-3.5 w-3.5" />}
              uncheckedIcon={<Sun className="h-3.5 w-3.5" />}
              checkedLabel="Switch to light mode"
              uncheckedLabel="Switch to dark mode"
            />
          </div>
        </Tippy>

        <AccountMenu />
      </div>

      {showEnvManager && (
        <EnvironmentManager open={true} onClose={() => setShowEnvManager(false)} />
      )}
    </header>
  );
}
