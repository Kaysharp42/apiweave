import { useState, useEffect, createContext } from 'react';
import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import { PaletteProvider } from './contexts/PaletteContext';
import { Toast } from './components/atoms/Toast';

interface AppContextValue {
  darkMode: boolean;
  setDarkMode: React.Dispatch<React.SetStateAction<boolean>>;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: React.Dispatch<React.SetStateAction<boolean>>;
}

export const AppContext = createContext<AppContextValue>({
  darkMode: false,
  setDarkMode: () => {},
  autoSaveEnabled: true,
  setAutoSaveEnabled: () => {},
});

function App() {
  const [darkMode, setDarkMode] = useState(() => {
    try {
      const stored = localStorage.getItem('darkMode');
      if (stored !== null) return stored === 'true';
      return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  });

  const [autoSaveEnabled, setAutoSaveEnabled] = useState(() => {
    try {
      const stored = localStorage.getItem('autoSaveEnabled');
      if (stored !== null) return stored === 'true';
      return true;
    } catch {
      return true;
    }
  });

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
    } catch {
      // ignore
    }
  }, [darkMode]);

  useEffect(() => {
    try {
      localStorage.setItem('autoSaveEnabled', autoSaveEnabled ? 'true' : 'false');
    } catch {
      // ignore
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
        <Toast />
      </PaletteProvider>
    </AppContext.Provider>
  );
}

export default App;
