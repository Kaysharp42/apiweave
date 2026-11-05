const DEFAULT_FALLBACK = "Untitled";

/**
 * A sidebar row's visible name.
 *
 * One job: turn a missing or whitespace-only name into something printable.
 * It used to also cut the string at a character budget, which was a second
 * truncation running before CSS's `truncate` — a row lost the tail of a name
 * even when it had room, while `title` still showed the whole thing. Length is
 * the layout's decision, so the full value is returned and CSS truncates it.
 */
export const getSidebarItemLabel = (
  value: unknown,
  fallback = DEFAULT_FALLBACK,
): string => {
  if (typeof value !== "string") return fallback;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : fallback;
};
