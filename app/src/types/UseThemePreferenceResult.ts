import type { ThemePreference } from "./ThemePreference";

/** The stored appearance preference and the theme it currently resolves to. */
export interface UseThemePreferenceResult {
  readonly themePreference: ThemePreference;
  readonly setThemePreference: (preference: ThemePreference) => void;
  readonly darkMode: boolean;
}
