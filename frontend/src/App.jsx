import React, { useState, useEffect } from 'react'
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import Home from './pages/Home'
import { PaletteProvider } from './contexts/PaletteContext'

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

  // Apply dark mode to document (Tailwind class + DaisyUI data-theme)
  useEffect(() => {
    try {
      if (darkMode) {
        document.documentElement.classList.add('dark');
        document.documentElement.setAttribute('data-theme', 'apiweave-dark');
      } else {
        document.documentElement.classList.remove('dark');
        document.documentElement.setAttribute('data-theme', 'apiweave');
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
      <PaletteProvider>
        <Router>
          <Routes>
            <Route path="/*" element={<Home />} />
          </Routes>
        </Router>
      </PaletteProvider>
    </AppContext.Provider>
  )
}

export default App
