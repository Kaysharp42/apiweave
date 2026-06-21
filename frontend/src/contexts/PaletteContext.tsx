import {
  createContext,
  useContext,
  useState,
  useCallback,
  type ReactNode,
} from "react";

interface ImportedGroup {
  id: string;
  title: string;
  items: unknown[];
}

interface PaletteContextValue {
  importedGroups: ImportedGroup[];
  addImportedGroup: (group: ImportedGroup) => void;
  removeImportedGroup: (id: string) => void;
  clearImportedGroups: () => void;
}

const PaletteContext = createContext<PaletteContextValue | null>(null);

export const usePalette = (): PaletteContextValue => {
  const ctx = useContext(PaletteContext);
  if (!ctx) throw new Error("usePalette must be used within a PaletteProvider");
  return ctx;
};

interface PaletteProviderProps {
  children: ReactNode;
}

export const PaletteProvider = ({ children }: PaletteProviderProps) => {
  const [importedGroups, setImportedGroups] = useState<ImportedGroup[]>([]);

  const addImportedGroup = useCallback((group: ImportedGroup) => {
    setImportedGroups((prev) => {
      const filtered = prev.filter((g) => g.id !== group.id);

      const baseTitle = group.title ?? "Imported";
      let finalTitle = baseTitle;
      let suffix = 2;
      const existingTitles = new Set(filtered.map((g) => g.title));
      while (existingTitles.has(finalTitle)) {
        finalTitle = `${baseTitle} (${suffix})`;
        suffix += 1;
      }
      return [
        ...filtered,
        { ...group, title: finalTitle, id: group.id ?? `grp-${Date.now()}` },
      ];
    });
  }, []);

  const removeImportedGroup = useCallback((id: string) => {
    setImportedGroups((prev) => prev.filter((g) => g.id !== id));
  }, []);

  const clearImportedGroups = useCallback(() => setImportedGroups([]), []);

  const value: PaletteContextValue = {
    importedGroups,
    addImportedGroup,
    removeImportedGroup,
    clearImportedGroups,
  };

  return (
    <PaletteContext.Provider value={value}>{children}</PaletteContext.Provider>
  );
};

export default PaletteContext;
