/**
 * Why `text` is not a JSON object template, or undefined (empty is fine).
 * Placeholders stand in for a value (`{{variables.id}}` alone may be a
 * number), so they are filled with one before parsing.
 */
export function jsonObjectTemplateProblem(text: string): string | undefined {
  if (!text.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(text.replace(/\{\{[^}]+\}\}/g, "0"));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)
      ? undefined
      : "Must be a JSON object";
  } catch (error) {
    return error instanceof Error ? error.message : "Invalid JSON";
  }
}
