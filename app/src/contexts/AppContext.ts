import { createContext } from "react";
import type { AppContextType } from "../types/AppContextType";

/**
 * App-wide preferences — the resolved theme and the auto-save toggle — provided
 * by `App` and read by the chrome and the canvas.
 *
 * Its own module rather than an export of `App.tsx`: everything `App` renders
 * would otherwise import back from the component that renders it.
 */
export const AppContext = createContext<AppContextType>({
  darkMode: false,
  themePreference: "system",
  setThemePreference: () => {},
  autoSaveEnabled: true,
  setAutoSaveEnabled: () => {},
});
