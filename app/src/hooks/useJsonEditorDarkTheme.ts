import { useMemo } from "react";
import type { JsonEditorProps } from "json-edit-react";

/**
 * The `json-edit-react` theme override applied when the app is in dark mode --
 * the library's built-in dark theme doesn't match the app's design tokens, so
 * every tree view (response body, node output) recolors it to the same
 * palette. `undefined` in light mode leaves the library's default theme in
 * place.
 */
export function useJsonEditorDarkTheme(
  isDarkMode: boolean,
): JsonEditorProps["theme"] | undefined {
  return useMemo(() => {
    if (!isDarkMode) return undefined;

    return {
      container: {
        backgroundColor: "var(--color-surface-dark-raised)",
        color: "var(--color-text-primary-dark)",
      },
      collection: { backgroundColor: "transparent" },
      collectionInner: { backgroundColor: "transparent" },
      collectionElement: { backgroundColor: "transparent" },
      property: { color: "var(--color-text-primary-dark)" },
      bracket: { color: "var(--color-text-secondary-dark)" },
      itemCount: { color: "var(--color-text-muted-dark)" },
      iconCollection: { color: "var(--aw-primary)" },
      string: { color: "var(--color-success)" },
      number: { color: "var(--color-info)" },
      boolean: { color: "var(--color-primary-dark)" },
      null: { color: "var(--color-warning)" },
      input: {
        backgroundColor: "var(--color-surface-dark-overlay)",
        color: "var(--color-text-primary-dark)",
        border: "1px solid var(--color-border-dark)",
      },
      inputHighlight: { backgroundColor: "var(--color-surface-dark-overlay)" },
      error: { color: "var(--color-error)" },
    } as const;
  }, [isDarkMode]);
}
