/**
 * Persists the user's last-selected workspace slug so the app can reopen it
 * after a restart instead of always falling back to the personal workspace.
 *
 * Follows the same `apiweave:v1:` versioned-prefix convention used by the
 * other localStorage-backed preferences (e.g. darkMode). The unversioned key
 * is mirrored so a future version bump can still read the old value.
 */

const STORAGE_PREFIX = "apiweave:v1:";
const KEY = "lastWorkspaceSlug";
const VERSIONED_KEY = `${STORAGE_PREFIX}${KEY}`;

export function getLastWorkspaceSlug(): string | null {
  if (typeof window === "undefined") return null;
  return (
    window.localStorage.getItem(VERSIONED_KEY) ??
    window.localStorage.getItem(KEY)
  );
}

export function setLastWorkspaceSlug(slug: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(VERSIONED_KEY, slug);
  window.localStorage.setItem(KEY, slug);
}

export function clearLastWorkspaceSlug(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(VERSIONED_KEY);
  window.localStorage.removeItem(KEY);
}
