/**
 * The subset of the Web Storage API a guarded adapter needs. Narrower than
 * `Storage` so a test can substitute a failing implementation without
 * implementing the whole interface.
 */
export interface GuardedStorage {
  getItem: (name: string) => string | null;
  setItem: (name: string, value: string) => void;
  removeItem: (name: string) => void;
}
