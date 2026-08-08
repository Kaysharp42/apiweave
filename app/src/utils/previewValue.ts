/**
 * Renders `value` as a short, single-line preview for extractor UI (the save-
 * variable popover, the extractor row list) -- JSON-stringified and truncated
 * so a large captured value never blows out the row it sits in.
 */
export function previewValue(value: unknown, limit: number): string {
  let text: string;
  try {
    text = JSON.stringify(value) ?? String(value);
  } catch {
    text = String(value);
  }
  return text.length > limit ? `${text.slice(0, limit - 1)}…` : text;
}
