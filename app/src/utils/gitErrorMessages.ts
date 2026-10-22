import type { GitErrorCode } from "@shared/types/GitErrorCode";
import type { WorkspaceGitError } from "@shared/types/WorkspaceGitError";

/** What to call the remote when its URL names no host (a `file://` path, say). */
const UNNAMED_REMOTE = "the remote";

/**
 * The host a remote URL names: `github.com` for `https://github.com/a/b.git`,
 * `ssh://git@github.com/a/b.git` and `git@github.com:a/b.git` alike. Null when
 * it names none.
 */
export function remoteHost(remoteUrl: string | null): string | null {
  if (remoteUrl === null) return null;
  const scpLike = /^[^@\s/]+@([^:/\s]+):/.exec(remoteUrl);
  if (scpLike?.[1] !== undefined) return scpLike[1];
  try {
    const { hostname } = new URL(remoteUrl);
    return hostname === "" ? null : hostname;
  } catch {
    return null;
  }
}

/**
 * One sentence per failure, saying what happened and what to do next. Keyed by
 * the code, so adding a `GitErrorCode` fails to compile until it has one.
 */
const MESSAGES: Readonly<Record<GitErrorCode, (host: string) => string>> = {
  git_not_installed: () =>
    "Git isn't installed — install Git and restart APIWeave.",
  identity_missing: () =>
    "Git doesn't know who you are on this machine — enter your name and email in the workspace's version history settings.",
  auth_failed: (host) =>
    `Sign-in to ${host} failed — your credential manager will ask again on retry.`,
  non_fast_forward: () =>
    "Someone pushed to the remote at the same moment — retry to bring their changes in first.",
  // A refused push is not this: it makes the workspace read-only, which explains itself. This is a fetch or a clone the host refused.
  permission_denied: (host) =>
    `${host} refused access to this repo — check the URL, and that you're signed in with an account that can read it.`,
  network_error: (host) =>
    `Can't reach ${host} — check your connection. APIWeave retries every 5 minutes.`,
  timeout: (host) =>
    `${host} took too long to answer — check your connection and retry.`,
  not_a_repository: () =>
    "This workspace's history folder on this device is missing or damaged. If it is missing, restarting APIWeave recreates it; if it is damaged, stop tracking the workspace in its version history settings and track it again.",
  invalid_argument: () =>
    "APIWeave can't use this remote address or branch name — check them in the workspace's version history settings.",
  command_failed: () =>
    "Git reported an error APIWeave doesn't recognise — retry, and see the details below if it persists.",
};

/**
 * The message for a failed sync. A failure with no code is not git's — a
 * record the repository format refused, say — and its own text already says
 * what happened, so that is the message. `lastError.message` is git's raw
 * text: it belongs under the message as detail, never in place of it.
 */
export function describeGitError(
  error: WorkspaceGitError,
  remoteUrl: string | null,
): string {
  if (error.code === null) return error.message;
  return MESSAGES[error.code](remoteHost(remoteUrl) ?? UNNAMED_REMOTE);
}
