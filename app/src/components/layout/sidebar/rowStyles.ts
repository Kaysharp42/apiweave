/**
 * The class sets the two sidebar row types share, so a workflow listed under a
 * project and a project itself look the same in the same state.
 */

/** The row's border and fill: selected, its right-click menu open, or at rest. */
export function rowSurface(isActive: boolean, isMenuOpen: boolean): string {
  if (isActive) {
    return "border-border bg-primary/10 dark:border-border-dark dark:bg-primary-light/10";
  }
  if (isMenuOpen) {
    return "border-border bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-overlay";
  }
  return "border-transparent hover:border-border hover:bg-surface-overlay dark:hover:border-border-dark dark:hover:bg-surface-dark-overlay";
}

/** The row's icon: primary on the selected row, muted on every other. */
export function rowIconColor(isActive: boolean): string {
  return isActive
    ? "text-primary dark:text-primary-light"
    : "text-text-muted dark:text-text-muted-dark";
}

/** The row's name: primary on the selected row, primary text on every other. */
export function rowNameColor(isActive: boolean): string {
  return isActive
    ? "text-primary dark:text-primary-light"
    : "text-text-primary dark:text-text-primary-dark";
}
