import type { GitIdentity } from "./GitIdentity"

/** What a commit asked for by the user carries. */
export interface WorkspaceGitCommitRequest {
  /** The commit's subject; left empty, it names the files the commit changed. */
  readonly message?: string | undefined
  /** The author to write into the workspace's repository first, after a commit reported `identity_missing`. */
  readonly identity?: GitIdentity | undefined
}
