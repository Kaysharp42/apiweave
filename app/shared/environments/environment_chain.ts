/**
 * The base-environment chain a repository file may hold: every environment
 * extends at most one other in the same workspace, and the chain from any
 * environment back to the one with no base is finite.
 *
 * `MAX_BASE_ENVIRONMENT_CHAIN_DEPTH` counts the environments in a chain, the
 * one read first included — the same depth `EnvironmentRepository.resolveEffectiveVariables`
 * resolves and `EnvironmentService` validates a write against. A tree deeper
 * than this is refused, because the resolver would silently drop the root.
 */
export const MAX_BASE_ENVIRONMENT_CHAIN_DEPTH = 8

/** The two fields of an environment a chain is made from. */
export interface EnvironmentBaseLink {
  readonly environmentId: string
  readonly baseEnvironmentId: string | null
}

/**
 * What is wrong with `environments` as a base-environment chain — a base that
 * is not in the list, a self-reference, a cycle, or a chain deeper than
 * {@link MAX_BASE_ENVIRONMENT_CHAIN_DEPTH} — or undefined when it is sound.
 * The list is one workspace's environments: a base outside it is a base in
 * another workspace, which no environment may extend.
 */
export function baseEnvironmentProblem(environments: readonly EnvironmentBaseLink[]): string | undefined {
  const byId = new Map(environments.map((environment) => [environment.environmentId, environment]))
  for (const environment of environments) {
    const chain = new Set([environment.environmentId])
    let current = environment
    while (current.baseEnvironmentId !== null) {
      const baseId = current.baseEnvironmentId
      const base = byId.get(baseId)
      if (base === undefined) {
        return `environment ${environment.environmentId} extends ${baseId}, which is not in this workspace`
      }
      if (chain.has(baseId)) {
        return `environment ${environment.environmentId} extends itself through ${baseId}: the base environment chain would create a cycle`
      }
      chain.add(baseId)
      if (chain.size > MAX_BASE_ENVIRONMENT_CHAIN_DEPTH) {
        return `environment ${environment.environmentId} would make the base environment chain deeper than ${MAX_BASE_ENVIRONMENT_CHAIN_DEPTH} environments`
      }
      current = base
    }
  }
  return undefined
}
