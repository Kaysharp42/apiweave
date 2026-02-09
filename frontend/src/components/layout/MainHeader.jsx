import React, { useContext, useState } from 'react';
import { AppContext } from '../../App';
import EnvironmentManager from '../EnvironmentManager';
import { Moon, Sun, Folder, Save, User } from 'lucide-react';
import Tippy from '@tippyjs/react';
import 'tippy.js/dist/tippy.css';

const MainHeader = () => {
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } = useContext(AppContext);
  const [showEnvManager, setShowEnvManager] = useState(false);

  return (
    <header className="navbar h-header min-h-0 px-4 bg-surface-raised dark:bg-surface-dark-raised border-b border-border dark:border-border-dark transition-colors">
      {/* Left: Logo + Wordmark */}
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

      {/* Center: empty (future breadcrumb) */}
      <div className="navbar-center" />

      {/* Right: Controls */}
      <div className="navbar-end gap-1">
        {/* Environment Dropdown */}
        <Tippy content="Manage Environments" placement="bottom">
          <button
            onClick={() => setShowEnvManager(true)}
            className="btn btn-ghost btn-sm gap-1.5 text-text-secondary dark:text-text-secondary-dark hover:text-primary dark:hover:text-cyan-400"
          >
            <Folder className="w-4 h-4" />
            <span className="text-xs font-medium hidden sm:inline">Environments</span>
          </button>
        </Tippy>

        {/* Auto-save Toggle */}
        <Tippy content={autoSaveEnabled ? 'Auto-save enabled' : 'Auto-save disabled'} placement="bottom">
          <label className="swap swap-rotate btn btn-ghost btn-sm btn-square">
            <input
              type="checkbox"
              checked={autoSaveEnabled}
              onChange={() => setAutoSaveEnabled(!autoSaveEnabled)}
            />
            <Save className={`w-4 h-4 swap-on ${autoSaveEnabled ? 'text-status-success' : ''}`} />
            <Save className="w-4 h-4 swap-off text-text-muted dark:text-text-muted-dark" />
          </label>
        </Tippy>

        {/* Dark Mode Toggle */}
        <Tippy content={darkMode ? 'Switch to Light mode' : 'Switch to Dark mode'} placement="bottom">
          <label className="swap swap-rotate btn btn-ghost btn-sm btn-square">
            <input
              type="checkbox"
              checked={darkMode}
              onChange={() => setDarkMode(!darkMode)}
            />
            <Moon className="w-4 h-4 swap-on text-cyan-400" />
            <Sun className="w-4 h-4 swap-off text-amber-500" />
          </label>
        </Tippy>

        {/* User Avatar Placeholder */}
        <Tippy content="Account (coming soon)" placement="bottom">
          <button className="btn btn-ghost btn-sm btn-circle" disabled>
            <User className="w-4 h-4 text-text-muted dark:text-text-muted-dark" />
          </button>
        </Tippy>
      </div>

      {/* Environment Manager Modal */}
      <EnvironmentManager open={showEnvManager} onClose={() => setShowEnvManager(false)} />
    </header>
  );
};

export default MainHeader;
