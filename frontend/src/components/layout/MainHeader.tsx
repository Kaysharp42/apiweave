import { useContext, useState } from 'react';
// @ts-expect-error App.jsx not yet migrated
import { AppContext } from '../../App';
// @ts-expect-error EnvironmentManager.jsx not yet migrated
import EnvironmentManager from '../EnvironmentManager';
import { Moon, Sun, Folder, Save, User } from 'lucide-react';
import Tippy from '@tippyjs/react';
// @ts-expect-error CSS import without types
import 'tippy.js/dist/tippy.css';
import { IconButton, Toggle } from '../atoms';
import type { AppContextType } from '../../types/AppContextType';

export function MainHeader() {
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } = useContext(AppContext) as AppContextType;
  const [showEnvManager, setShowEnvManager] = useState(false);

  return (
    <header className="navbar h-header min-h-0 px-4 bg-surface-raised dark:bg-surface-dark-raised border-b border-border dark:border-border-dark transition-colors">
      <div className="navbar-start gap-3">
        <img
          src="/public/apiweave.png"
          alt="APIWeave Logo"
          className="h-7 w-7 rounded-lg shadow-sm object-cover"
        />
        <h1 className="text-lg font-display font-bold tracking-tight text-primary dark:text-cyan-400">
          APIWeave
        </h1>
      </div>

      <div className="navbar-center" />

      <div className="navbar-end gap-1">
        <IconButton
          tooltip="Manage Environments"
          onClick={() => setShowEnvManager(true)}
        >
          <Folder className="w-4 h-4" />
          <span className="text-xs font-medium hidden sm:inline">Environments</span>
        </IconButton>

        <Tippy content={autoSaveEnabled ? 'Auto-save enabled' : 'Auto-save disabled'} placement="bottom">
          <div className="flex items-center">
            <Toggle
              checked={autoSaveEnabled}
              onChange={() => setAutoSaveEnabled(!autoSaveEnabled)}
              variant="success"
              size="sm"
              aria-label="Toggle auto-save"
            />
            <Save className={`w-4 h-4 ${autoSaveEnabled ? 'text-status-success' : 'text-text-muted dark:text-text-muted-dark'}`} />
          </div>
        </Tippy>

        <Tippy content={darkMode ? 'Switch to Light mode' : 'Switch to Dark mode'} placement="bottom">
          <div className="flex items-center">
            <Toggle
              checked={darkMode}
              onChange={() => setDarkMode(!darkMode)}
              variant="primary"
              size="sm"
              aria-label="Toggle dark mode"
            />
            {darkMode ? (
              <Moon className="w-4 h-4 text-cyan-400" />
            ) : (
              <Sun className="w-4 h-4 text-amber-500" />
            )}
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
