import type { Dispatch, SetStateAction } from "react";

export interface AppContextType {
  darkMode: boolean;
  setDarkMode: Dispatch<SetStateAction<boolean>>;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: Dispatch<SetStateAction<boolean>>;
}
