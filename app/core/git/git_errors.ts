export type GitErrorCode =
  | "git_not_installed"
  | "auth_failed"
  | "non_fast_forward"
  | "permission_denied"
  | "network_error"
  | "not_a_repository"
  | "timeout"
  | "invalid_argument"
  | "command_failed"

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
