import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'

// Create contexts for global state with default values
export const AppContext = React.createContext({
  darkMode: false,
  setDarkMode: () => {},
  autoSaveEnabled: true,
  setAutoSaveEnabled: () => {}
});

function App() {
  // Dark mode state (persisted globally)
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = localStorage.getItem('darkMode');
      if (stored !== null) return stored === 'true';
      // default to system preference
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch (err) {
      return false;
    }
  });

  // Auto-save state (persisted globally)
  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem('autoSaveEnabled');
      if (stored !== null) return stored === 'true';
      return true; // default enabled
    } catch (err) {
      return true;
    }
  });

  // Apply dark mode to document
  useEffect(() => {
    console.log('Dark mode changed to:', darkMode);
    try {
      if (darkMode) {
        document.documentElement.classList.add('dark');
        console.log('Added dark class to html');
      } else {
        document.documentElement.classList.remove('dark');
        console.log('Removed dark class from html');
      }
      localStorage.setItem('darkMode', darkMode ? 'true' : 'false');
    } catch (err) {
      console.error('Error applying dark mode:', err);
    }
  }, [darkMode]);

  // Persist auto-save preference
  useEffect(() => {
    try {
      localStorage.setItem('autoSaveEnabled', autoSaveEnabled ? 'true' : 'false');
    } catch (err) {
      console.error('Error saving auto-save preference:', err);
    }
  }, [autoSaveEnabled]);

  return (
    <AppContext.Provider value={{ darkMode, setDarkMode, autoSaveEnabled, setAutoSaveEnabled }}>
      <Router>
        <Routes>
          <Route path="/*" element={<Home />} />
        </Routes>
      </Router>
    </AppContext.Provider>
  )
}

export default App
