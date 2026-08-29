/**
 * Format an ISO timestamp for read-only metadata surfaces (secret cards, list
 * rows): short date plus hours and minutes, in the user's locale. Unparseable
 * input is shown as-is rather than rendered as "Invalid Date".
 */
export function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}
