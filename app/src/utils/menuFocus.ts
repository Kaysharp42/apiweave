/**
 * The index a roving-focus menu should move to after `key`, or null when the
 * key is not one of the four that move focus. Arrow keys wrap at both ends;
 * Home and End jump to the edges.
 */
export function nextMenuFocusIndex(
  key: string,
  currentIndex: number,
  total: number,
): number | null {
  if (total <= 0) return null;
  switch (key) {
    case "ArrowDown":
      return (currentIndex + 1) % total;
    case "ArrowUp":
      return (currentIndex - 1 + total) % total;
    case "Home":
      return 0;
    case "End":
      return total - 1;
    default:
      return null;
  }
}
