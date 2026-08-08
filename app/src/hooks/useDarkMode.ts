import { useEffect, useState } from "react";

function isDarkModeActive(): boolean {
  try {
    return document.documentElement.classList.contains("dark");
  } catch {
    return false;
  }
}

/**
 * Tracks whether the `dark` class is present on `<html>`, staying in sync with
 * the theme toggle via a `MutationObserver` rather than polling. Shared by the
 * response/output tree views and the Monaco editor, which each need to pick a
 * theme that matches the app's current color scheme.
 */
export function useDarkMode(): boolean {
  const [isDarkMode, setIsDarkMode] = useState(isDarkModeActive);

  useEffect(() => {
    const root = document.documentElement;
    const syncDarkMode = () => setIsDarkMode(root.classList.contains("dark"));

    const observer = new MutationObserver(syncDarkMode);
    observer.observe(root, { attributes: true, attributeFilter: ["class"] });

    return () => observer.disconnect();
  }, []);

  return isDarkMode;
}
