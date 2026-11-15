import { listScopedSecrets } from "../hooks/useSecretValues";

/**
 * Secret names a workflow can reach — the workspace's and its environment's —
 * one request per workspace+environment pair. Names only: a secret's value is
 * never in the renderer. A secret saved from this window drops its workspace's
 * entries ({@link forgetSecretNames}) and tells every mounted reader to read
 * again; one added in another window shows after a reload.
 */
const secretNamesByScope = new Map<string, Promise<readonly string[]>>();

/**
 * Told after a cached list is dropped. Every reader holds its own copy of the
 * names, so a save made in one component would otherwise leave the rest of the
 * window reading a list it fetched before the save — the badge on the canvas
 * outliving the notice in the panel that cleared it.
 */
const listeners = new Set<() => void>();
let revision = 0;

/**
 * Changes whenever a cached list is dropped. A snapshot for
 * `useSyncExternalStore`: it is a plain number, so it is stable between
 * notifications, which is what the hook requires.
 */
export function getSecretNamesRevision(): number {
  return revision;
}

/** Run `listener` after the next drop, so the reader can fetch again. */
export function subscribeSecretNames(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function fetchSecretNames(workspaceId: string, environmentId: string | null): Promise<readonly string[]> {
  const key = `${workspaceId}::${environmentId ?? ""}`;
  const cached = secretNamesByScope.get(key);
  if (cached) return cached;

  const pending = Promise.all([
    listScopedSecrets("workspace", workspaceId, workspaceId),
    environmentId ? listScopedSecrets("environment", environmentId, workspaceId) : Promise.resolve([]),
  ])
    .then(([workspaceSecrets, environmentSecrets]) =>
      [...new Set([...workspaceSecrets, ...environmentSecrets].map((secret) => secret.name))].sort(),
    )
    .catch(() => {
      // Don't cache a failure: the next reader retries.
      secretNamesByScope.delete(key);
      return [];
    });

  secretNamesByScope.set(key, pending);
  return pending;
}

/** Drop every cached list for a workspace, after one of its secrets was added. */
export function forgetSecretNames(workspaceId: string): void {
  for (const key of secretNamesByScope.keys()) {
    if (key.startsWith(`${workspaceId}::`)) secretNamesByScope.delete(key);
  }
  // Bumped even when nothing was cached: a fetch may still be in flight, and
  // its reader has to be told to ask again rather than keep that answer.
  revision += 1;
  for (const listener of [...listeners]) listener();
}
