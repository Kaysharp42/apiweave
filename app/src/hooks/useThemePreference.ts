import { useCallback, useEffect, useState } from "react";
import type { ThemePreference, UseThemePreferenceResult } from "../types";
import { getStoredValue, setStoredValue } from "../utils/storedValue";

const THEME_PREFERENCE_KEY = "themePreference";
const DARK_SCHEME_QUERY = "(prefers-color-scheme: dark)";

function isThemePreference(value: string | null): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

function readThemePreference(): ThemePreference {
  try {
    const stored = getStoredValue(THEME_PREFERENCE_KEY);
    return isThemePreference(stored) ? stored : "system";
  } catch {
    return "system";
  }
}

function systemPrefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia(DARK_SCHEME_QUERY).matches
  );
}

/** The one rule that turns a preference and the OS setting into a theme. */
export function resolveDarkMode(
  preference: ThemePreference,
  prefersDark: boolean,
): boolean {
  if (preference === "system") return prefersDark;
  return preference === "dark";
}

/**
 * The appearance preference, kept live against the OS setting.
 *
 * `system` is the stored value and the default, so a fresh install follows the
 * desktop. The `matchMedia` listener stays attached for every preference
 * because switching back to `system` must take effect without a remount; the
 * resolved `darkMode` only reads it while the preference is `system`.
 */
export function useThemePreference(): UseThemePreferenceResult {
  const [themePreference, setPreference] =
    useState<ThemePreference>(readThemePreference);
  const [prefersDark, setPrefersDark] = useState<boolean>(systemPrefersDark);

  useEffect(() => {
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function"
    ) {
      return;
    }
    const media = window.matchMedia(DARK_SCHEME_QUERY);
    const sync = () => setPrefersDark(media.matches);
    // The OS can have flipped between the seeding render and this effect.
    sync();
    media.addEventListener("change", sync);
    return () => media.removeEventListener("change", sync);
  }, []);

  const setThemePreference = useCallback((next: ThemePreference) => {
    setPreference(next);
    try {
      setStoredValue(THEME_PREFERENCE_KEY, next);
    } catch {
      // A locked-down or full storage must not stop the preference applying
      // for this session.
    }
  }, []);

  return {
    themePreference,
    setThemePreference,
    darkMode: resolveDarkMode(themePreference, prefersDark),
  };
}
