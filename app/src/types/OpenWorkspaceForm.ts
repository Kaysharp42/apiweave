import type { GitRemoteSelection } from "./GitRemoteSelection";

/** The open-from-git form: the remote chosen, and the branch to clone ("" for its default). */
export interface OpenWorkspaceForm {
  readonly selection: GitRemoteSelection | null;
  readonly branch: string;
}
