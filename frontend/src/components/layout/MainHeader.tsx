import { useContext, useState } from 'react';
import { AppContext } from '../../App';
import EnvironmentManager from '../EnvironmentManager';
import { Moon, Sun, Folder, Save, User } from 'lucide-react';
import Tippy from '@tippyjs/react';
// @ts-expect-error CSS import without types
import 'tippy.js/dist/tippy.css';
import { Button, IconButton, IconSwitch } from '../atoms';
import type { AppContextType } from '../../types/AppContextType';

export function MainHeader() {
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } = useContext(AppContext) as AppContextType;
  const [showEnvManager, setShowEnvManager] = useState(false);

  return (
    <header className="navbar h-header min-h-0 w-full gap-3 px-4 bg-surface-raised dark:bg-surface-dark-raised border-b border-border dark:border-border-dark transition-colors">
      <div className="navbar-start min-w-0 flex-shrink-0 gap-3">
        <img
          src="/public/apiweave.png"
          alt="APIWeave Logo"
          className="h-7 w-7 rounded-lg shadow-sm object-cover"
        />
        <h1 className="text-lg font-display font-bold tracking-tight text-primary dark:text-cyan-400">
          APIWeave
        </h1>
      </div>

      <div className="navbar-center min-w-0 flex-1" />

      <div className="navbar-end min-w-0 flex-shrink gap-2 overflow-hidden">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => setShowEnvManager(true)}
          title="Manage Environments"
          className="min-w-0 max-w-[11rem] flex-shrink"
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

        <Tippy content="Account (coming soon)" placement="bottom">
          <span>
            <IconButton disabled tooltip="Account (coming soon)">
              <User className="w-4 h-4 text-text-muted dark:text-text-muted-dark" />
            </IconButton>
          </span>
        </Tippy>
      </div>

      <EnvironmentManager open={showEnvManager} onClose={() => setShowEnvManager(false)} />
    </header>
  );
}
