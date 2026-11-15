import { listScopedSecrets } from "../hooks/useSecretValues";

/**
 * Secret names a workflow can reach — the workspace's and its environment's —
 * one request per workspace+environment pair. Names only: a secret's value is
 * never in the renderer. A secret saved from this window drops its workspace's
 * entries ({@link forgetSecretNames}); one added in another window shows after
 * a reload.
 */
const secretNamesByScope = new Map<string, Promise<readonly string[]>>();

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
}
