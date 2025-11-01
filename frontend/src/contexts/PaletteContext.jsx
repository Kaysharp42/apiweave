import React, { createContext, useContext, useState, useCallback } from 'react';

const PaletteContext = createContext(null);

export const usePalette = () => {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error('usePalette must be used within a PaletteProvider');
  return ctx;
};

export const PaletteProvider = ({ children }) => {
  const [importedGroups, setImportedGroups] = useState([]);

  const addImportedGroup = useCallback((group) => {
    setImportedGroups((prev) => {
      // Remove any existing group with the same ID to prevent duplicates
      const filtered = prev.filter(g => g.id !== group.id);
      
      // Ensure unique title in the list
      const baseTitle = group.title || 'Imported';
      let finalTitle = baseTitle;
      let suffix = 2;
      const existingTitles = new Set(filtered.map(g => g.title));
      while (existingTitles.has(finalTitle)) {
        finalTitle = `${baseTitle} (${suffix})`;
        suffix += 1;
      }
      return [...filtered, { ...group, title: finalTitle, id: group.id || `grp-${Date.now()}` }];
    });
  }, []);

  const removeImportedGroup = useCallback((id) => {
    setImportedGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const clearImportedGroups = useCallback(() => setImportedGroups([]), []);

  const value = {
    importedGroups,
    addImportedGroup,
    removeImportedGroup,
    clearImportedGroups,
  };

  return (
    <PaletteContext.Provider value={value}>
      {children}
    </PaletteContext.Provider>
  );
};

export default PaletteContext;

