const STORAGE_PREFIX = "apiweave:v1:";

/**
 * Preferences are written to both the versioned key and the bare one: the
 * versioned key is the contract, and the bare key is what an older build (and
 * therefore a downgrade) reads.
 */
export function getStoredValue(key: string): string | null {
  const versionedKey = `${STORAGE_PREFIX}${key}`;
  return localStorage.getItem(versionedKey) ?? localStorage.getItem(key);
}

export function setStoredValue(key: string, value: string): void {
  localStorage.setItem(`${STORAGE_PREFIX}${key}`, value);
  localStorage.setItem(key, value);
}
