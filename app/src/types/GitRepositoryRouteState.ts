import type { GitRepositoryDraft } from "./GitRepositoryDraft";

/** What Create workspace leaves for Version history when its sync stopped: the repository it was to create. */
export interface GitRepositoryRouteState {
  readonly gitRepositoryDraft?: GitRepositoryDraft;
}

/** The draft a route carries for Version history, when it carries one that names an account. */
export function routeRepositoryDraft(
  state: unknown,
): GitRepositoryDraft | null {
  if (typeof state !== "object" || state === null) return null;
  const draft = (state as GitRepositoryRouteState).gitRepositoryDraft;
  return draft !== undefined && draft !== null && draft.account !== null
    ? draft
    : null;
}
