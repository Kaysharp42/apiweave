import React, { useContext } from 'react';
import { AppContext } from '../../App';

const MainHeader = () => {
  const context = useContext(AppContext);
  console.log('MainHeader context:', context);
  const { darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled } = context;

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
          <div className="flex items-center gap-2">
            {/* Autosave Toggle */}
            <button
              onClick={handleAutoSaveToggle}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 transition-all ${
                autoSaveEnabled 
                  ? 'bg-cyan-900 border-cyan-950 text-white dark:bg-cyan-800 dark:border-cyan-900' 
                  : 'bg-white border-gray-300 text-gray-700 hover:border-cyan-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200 dark:hover:border-cyan-500'
              }`}
              title={autoSaveEnabled ? 'Auto-save enabled (Global)' : 'Auto-save disabled (Global)'}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              <span className="text-xs font-medium hidden sm:inline">Auto-save</span>
            </button>

            {/* Dark Mode Toggle */}
            <button
              onClick={handleDarkModeToggle}
              className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border-2 transition-all ${
                darkMode 
                  ? 'bg-gray-900 border-gray-950 text-yellow-400 dark:bg-gray-700 dark:border-gray-600' 
                  : 'bg-white border-gray-300 text-gray-700 hover:border-gray-600 dark:bg-gray-700 dark:border-gray-600 dark:text-gray-200'
              }`}
              title={darkMode ? 'Switch to Light mode' : 'Switch to Dark mode'}
            >
              {darkMode ? (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M17.293 13.293A8 8 0 016.707 2.707a8.001 8.001 0 1010.586 10.586z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                  <path fillRule="evenodd" d="M10 2a1 1 0 011 1v1a1 1 0 11-2 0V3a1 1 0 011-1zm4 8a4 4 0 11-8 0 4 4 0 018 0zm-.464 4.95l.707.707a1 1 0 001.414-1.414l-.707-.707a1 1 0 00-1.414 1.414zm2.12-10.607a1 1 0 010 1.414l-.706.707a1 1 0 11-1.414-1.414l.707-.707a1 1 0 011.414 0zM17 11a1 1 0 100-2h-1a1 1 0 100 2h1zm-7 4a1 1 0 011 1v1a1 1 0 11-2 0v-1a1 1 0 011-1zM5.05 6.464A1 1 0 106.465 5.05l-.708-.707a1 1 0 00-1.414 1.414l.707.707zm1.414 8.486l-.707.707a1 1 0 01-1.414-1.414l.707-.707a1 1 0 011.414 1.414zM4 11a1 1 0 100-2H3a1 1 0 000 2h1z" clipRule="evenodd" />
                </svg>
              )}
              <span className="text-xs font-medium hidden sm:inline">{darkMode ? 'Dark' : 'Light'}</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
};

export default MainHeader;
