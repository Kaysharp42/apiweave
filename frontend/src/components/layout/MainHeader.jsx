import React, { useContext, useState } from 'react';
import { AppContext } from '../../App';
import EnvironmentManager from '../EnvironmentManager';
import { RefreshCw, Moon, Sun, Folder } from 'lucide-react';

const MainHeader = () => {
  const context = useContext(AppContext);
  console.log('MainHeader context:', context);
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } = context;
  const [showEnvManager, setShowEnvManager] = useState(false);

  const handleDarkModeToggle = () => {
    console.log('Dark mode toggle clicked, current:', darkMode);
    setDarkMode(!darkMode);
  };

  const handleAutoSaveToggle = () => {
    console.log('Auto-save toggle clicked, current:', autoSaveEnabled);
    setAutoSaveEnabled(!autoSaveEnabled);
  };

  return (
    <header className="bg-white dark:bg-gray-800 px-4 py-3 border-b dark:border-gray-700 transition-colors">
      <div className="flex items-center justify-between">
        <div className="flex items-center space-x-3">
          <img 
            src="/public/apiweave.png" 
            alt="APIWeave Logo" 
            className="h-8 w-8 rounded-lg shadow-sm object-cover"
          />
          <h1 className="text-xl font-bold text-cyan-900 dark:text-cyan-400">APIWeave</h1>
        </div>
        
        <div className="flex items-center gap-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 hidden md:block">
            Visual API Test Workflows Made Simple
          </p>
          
          {/* Global Controls */}
          <div className="flex items-center gap-0 divide-x divide-gray-200 dark:divide-gray-600">
            {/* Manage Environments Button */}
            <button
              onClick={() => setShowEnvManager(true)}
              className="flex items-center gap-2 px-3 py-1.5 rounded-l-lg border-2 bg-white border-gray-300 text-gray-700 hover:border-cyan-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:border-cyan-500 transition-all"
              title="Manage Environments"
            >
              <Folder className="w-4 h-4" />
              <span className="text-xs font-medium hidden sm:inline">Environments</span>
            </button>

            {/* Autosave Toggle */}
            <button
              onClick={handleAutoSaveToggle}
              className={`flex items-center gap-2 px-3 py-1.5 border-2 border-l-0 transition-all ${
                autoSaveEnabled 
                  ? 'bg-cyan-900 border-cyan-950 text-white dark:bg-cyan-800 dark:border-cyan-900' 
                  : 'bg-white border-gray-300 text-gray-700 hover:border-cyan-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:border-cyan-500'
              }`}
              title={autoSaveEnabled ? 'Auto-save enabled (Global)' : 'Auto-save disabled (Global)'}
            >
              <RefreshCw className="w-4 h-4" />
              <span className="text-xs font-medium hidden sm:inline">Auto-save</span>
            </button>

            {/* Dark Mode Toggle */}
            <button
              onClick={handleDarkModeToggle}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-r-lg border-2 border-l-0 transition-all ${
                darkMode 
                  ? 'bg-gray-900 border-gray-950 text-yellow-400 dark:bg-gray-700 dark:border-gray-600' 
                  : 'bg-white border-gray-300 text-gray-700 hover:border-gray-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200'
              }`}
              title={darkMode ? 'Switch to Light mode' : 'Switch to Dark mode'}
            >
              {darkMode ? (
                <Moon className="w-4 h-4" />
              ) : (
                <Sun className="w-4 h-4" />
              )}
              <span className="text-xs font-medium hidden sm:inline">{darkMode ? 'Dark' : 'Light'}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Environment Manager Modal */}
      {showEnvManager && (
        <EnvironmentManager onClose={() => setShowEnvManager(false)} />
      )}
    </header>
  );
};

export default MainHeader;
