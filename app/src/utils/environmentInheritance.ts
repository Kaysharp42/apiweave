import type { ScopedEnvironment } from "../types/ScopedEnvironment";

const MAX_CHAIN_DEPTH = 8;

/**
 * Environments that `environmentId` may legally extend: everything in the
 * workspace except itself and anything whose base chain already loops back
 * to it. Mirrors the cycle guard in `EnvironmentService.validateBaseEnvironment`
 * so the picker never offers a choice the backend would reject.
 */
export function getValidBaseEnvironmentOptions(
  environmentId: string | undefined,
  environments: readonly ScopedEnvironment[],
): ScopedEnvironment[] {
  return environments.filter((candidate) => {
    if (environmentId !== undefined && candidate.environmentId === environmentId) return false;
    if (environmentId === undefined) return true;
    return !chainReaches(candidate, environmentId, environments);
  });
}

function chainReaches(
  start: ScopedEnvironment,
  targetId: string,
  environments: readonly ScopedEnvironment[],
): boolean {
  const byId = new Map(environments.map((e) => [e.environmentId, e]));
  const seen = new Set<string>();
  let current: ScopedEnvironment | undefined = start;
  while (current !== undefined && !seen.has(current.environmentId) && seen.size < MAX_CHAIN_DEPTH) {
    if (current.environmentId === targetId) return true;
    seen.add(current.environmentId);
    current = current.baseEnvironmentId ? byId.get(current.baseEnvironmentId) : undefined;
  }
  return false;
}

/** Base-first, override-last merge of plain variables across the base chain. Preview-only — mirrors `EnvironmentRepository.resolveEffectiveVariables`. */
export function resolveInheritedVariables(
  baseEnvironmentId: string | null | undefined,
  environments: readonly ScopedEnvironment[],
): { readonly source: ScopedEnvironment; readonly variables: Record<string, string> }[] {
  if (!baseEnvironmentId) return [];
  const byId = new Map(environments.map((e) => [e.environmentId, e]));
  const chain: ScopedEnvironment[] = [];
  const seen = new Set<string>();
  let current = byId.get(baseEnvironmentId);
  while (current !== undefined && !seen.has(current.environmentId) && chain.length < MAX_CHAIN_DEPTH) {
    chain.push(current);
    seen.add(current.environmentId);
    current = current.baseEnvironmentId ? byId.get(current.baseEnvironmentId) : undefined;
  }
  return chain.reverse().map((source) => ({ source, variables: source.variables }));
}
