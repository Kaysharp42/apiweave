import type { GuardedStorage } from "../types";

/**
 * Wrap a Web Storage implementation so no call can throw out of the store.
 *
 * `localStorage.setItem` throws on quota exhaustion and, in some browser
 * configurations, on any access at all (private mode, blocked third-party
 * storage). `getItem` can throw the same way. Zustand's default storage does
 * not catch either, so a single failed write would reject the store action and
 * a corrupted read would reject hydration — leaving the tutorial unusable.
 *
 * Reads fall back to `null` (which Zustand treats as "no persisted state"), and
 * writes/removals become no-ops. The store stays fully usable in memory; only
 * persistence is lost, which is the correct degradation for progress data.
 *
 * The accessor is a getter rather than a value so a storage object that is
 * replaced after module load (or is absent entirely, as in some test
 * environments) is resolved on each call instead of captured once.
 */
export function guardedStorage(
  getStorage: () => GuardedStorage | null | undefined,
): GuardedStorage {
  return {
    getItem: (name: string): string | null => {
      try {
        return getStorage()?.getItem(name) ?? null;
      } catch {
        return null;
      }
    },
    setItem: (name: string, value: string): void => {
      try {
        getStorage()?.setItem(name, value);
      } catch {
        // Quota exhausted or storage disabled: keep the in-memory state and
        // drop the write.
      }
    },
    removeItem: (name: string): void => {
      try {
        getStorage()?.removeItem(name);
      } catch {
        // Same reasoning as setItem.
      }
    },
  };
}

/**
 * The renderer's `localStorage` behind the guard, or a no-op adapter when the
 * global is unavailable (SSR, hardened test environments).
 */
export function createGuardedLocalStorage(): GuardedStorage {
  return guardedStorage(() => {
    try {
      return typeof localStorage === "undefined" ? null : localStorage;
    } catch {
      // Accessing the global itself can throw when storage is disabled.
      return null;
    }
  });
}
