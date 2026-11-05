import type { Dispatch, SetStateAction } from "react";
import type { ThemePreference } from "./ThemePreference";

export interface AppContextType {
  /** The theme the stored preference currently resolves to. */
  readonly darkMode: boolean;
  readonly themePreference: ThemePreference;
  readonly setThemePreference: (preference: ThemePreference) => void;
  autoSaveEnabled: boolean;
  setAutoSaveEnabled: Dispatch<SetStateAction<boolean>>;
}
