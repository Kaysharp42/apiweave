import type { GitErrorCode } from "@shared/types/GitErrorCode"

export interface GitFailureDetails {
  /** The arguments after the configuration prefix, credentials in URLs removed. */
  readonly args: readonly string[]
  /** Undefined when git never ran to completion: not found, or killed on timeout. */
  readonly exitCode: number | undefined
  readonly stdout: string
  readonly stderr: string
}

/** Base for everything this module throws, so a caller can tell git failures from its own bugs. */
export abstract class GitError extends Error {
  abstract readonly code: GitErrorCode

  constructor(message: string) {
    super(message)
    this.name = new.target.name
  }
}

/** An argument refused before git ran, because it could be read as an option or a code-running transport. */
export class GitInvalidArgumentError extends GitError {
  readonly code = "invalid_argument"
}

/** A git process that ran, or failed to, with what it printed. */
export abstract class GitProcessError extends GitError {
  readonly details: GitFailureDetails

  constructor(message: string, details: GitFailureDetails) {
    super(message)
    this.details = details
  }
}

export class GitNotInstalledError extends GitProcessError {
  readonly code = "git_not_installed"
  readonly installUrl: string

  constructor(message: string, details: GitFailureDetails, installUrl: string) {
    super(message, details)
    this.installUrl = installUrl
  }
}

/**
 * A commit refused because git knows no author: no `user.name`/`user.email` in
 * any config it reads. Every call runs with `user.useConfigOnly`, so git never
 * guesses one from the login and host name instead.
 */
export class GitIdentityMissingError extends GitProcessError {
  readonly code = "identity_missing"
}

export class GitAuthFailedError extends GitProcessError {
  readonly code = "auth_failed"
}

export class GitNonFastForwardError extends GitProcessError {
  readonly code = "non_fast_forward"
}

export class GitPermissionDeniedError extends GitProcessError {
  readonly code = "permission_denied"
}

export class GitNetworkError extends GitProcessError {
  readonly code = "network_error"
}

export class GitNotARepositoryError extends GitProcessError {
  readonly code = "not_a_repository"
}

export class GitTimeoutError extends GitProcessError {
  readonly code = "timeout"
}

/** A failure that matches no class above. */
export class GitCommandError extends GitProcessError {
  readonly code = "command_failed"
}

/** `git remote set-url` / `remove` on a name the repository has no remote for: unclassified, so a {@link GitCommandError}. */
export function isNoSuchRemote(error: unknown): boolean {
  return error instanceof GitCommandError && /No such remote/i.test(error.details.stderr)
}

/** A push into the checked-out branch of a non-bare repository, which git's default `receive.denyCurrentBranch=refuse` turns away. */
export function isCheckedOutBranchRefusal(error: unknown): boolean {
  return error instanceof GitProcessError && /refusing to update checked out branch/i.test(error.details.stderr)
}

export function gitInstallUrl(platform: NodeJS.Platform): string {
  switch (platform) {
    case "win32":
      return "https://git-scm.com/download/win"
    case "darwin":
      return "https://git-scm.com/download/mac"
    default:
      return "https://git-scm.com/download/linux"
  }
}

const URL_USERINFO = /([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+@/gi

/** `https://user:token@host/…` → `https://host/…`: error text is logged and shown, so a credential must not ride in it. */
export function redactCredentials(text: string): string {
  return text.replace(URL_USERINFO, "$1")
}

export function failureDetails(
  args: readonly string[],
  exitCode: number | undefined,
  stdout: string,
  stderr: string,
): GitFailureDetails {
  return {
    args: args.map(redactCredentials),
    exitCode,
    stdout: redactCredentials(stdout),
    stderr: redactCredentials(stderr),
  }
}
