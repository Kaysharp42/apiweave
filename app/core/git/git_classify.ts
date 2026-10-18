import {
  GitAuthFailedError,
  GitCommandError,
  GitNetworkError,
  GitNonFastForwardError,
  GitNotARepositoryError,
  GitNotInstalledError,
  GitPermissionDeniedError,
  type GitError,
  type GitFailureDetails,
} from "./git_errors"

interface FailureRule {
  readonly patterns: readonly RegExp[]
  readonly create: (message: string, details: GitFailureDetails, installUrl: string) => GitError
}

/**
 * Matched against git's own stderr, which `LC_ALL=C` keeps in English. Order is
 * the precedence: a rejected push prints `failed to push some refs` whatever
 * the cause, and a 403 is printed under `unable to access`, so the specific
 * rules come first and network last.
 */
const RULES: readonly FailureRule[] = [
  {
    // The macOS /usr/bin/git stub, until the command-line tools are installed.
    patterns: [/xcode-select: (?:note|error): .*no developer tools were found/i],
    create: (message, details, installUrl) => new GitNotInstalledError(message, details, installUrl),
  },
  {
    patterns: [/not a git repository/i],
    create: (message, details) => new GitNotARepositoryError(message, details),
  },
  {
    patterns: [
      // Prompts are off, so a host that wants credentials ends here.
      /could not read (?:Username|Password) for/i,
      /Authentication failed/i,
      // GitHub: "Invalid username or password.", "Invalid username or token. Password authentication is not supported…"
      /Invalid username or (?:password|token)/i,
      /Support for password authentication was removed/i,
      // GitLab: "HTTP Basic: Access denied. The provided password or token is incorrect…"
      /HTTP Basic: Access denied/i,
      // Gitea: "remote: Unauthorized", "remote: invalid credentials"
      /remote: (?:Unauthorized|invalid credentials)/i,
      /returned error: 401/i,
      /Permission denied \((?:publickey|password|keyboard-interactive)/i,
      // GitHub answers a repository you cannot see exactly as one that does not exist, and so does GitLab.
      /Repository not found/i,
      /repository '.*' not found/i,
      /could not be found or you don't have permission to view it/i,
    ],
    create: (message, details) => new GitAuthFailedError(message, details),
  },
  {
    patterns: [
      /returned error: 403/i,
      // GitHub: "remote: Permission to o/r.git denied to user."
      /Permission to .+ denied/i,
      // GitHub GH006 "Protected branch update failed", GitLab "…push code to protected branches…", Gitea "branch main is protected"
      /protected branch/i,
      /branch \S+ is protected/i,
      /GH0(?:06|13)/,
      /pre-receive hook declined/i,
      /not allowed to push/i,
      /User permission denied/i,
    ],
    create: (message, details) => new GitPermissionDeniedError(message, details),
  },
  {
    patterns: [/\((?:non-fast-forward|fetch first)\)/i, /Updates were rejected because/i],
    create: (message, details) => new GitNonFastForwardError(message, details),
  },
  {
    patterns: [
      /Could not resolve host/i,
      /Could not resolve hostname/i,
      /Failed to connect to/i,
      /Couldn't connect to server/i,
      /Connection (?:timed out|refused|reset)/i,
      /Operation timed out/i,
      /Network is unreachable/i,
      /unable to connect to/i,
      /The remote end hung up unexpectedly/i,
      /early EOF/i,
      /RPC failed/i,
      /Empty reply from server/i,
      /(?:Recv|Send) failure/i,
      /SSL (?:connect error|certificate problem)/i,
      /OpenSSL SSL_(?:read|connect)/i,
      /schannel:/i,
      /returned error: 50[234]/i,
    ],
    create: (message, details) => new GitNetworkError(message, details),
  },
]

const SUMMARY_LIMIT = 400

function summarize(details: GitFailureDetails): string {
  const lines = details.stderr
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
  if (lines.length === 0) {
    return `exit code ${details.exitCode ?? "unknown"}`
  }
  return lines.join(" | ").slice(0, SUMMARY_LIMIT)
}

/** The error for a git process that exited non-zero: the class its stderr matches, else a plain {@link GitCommandError}. */
export function gitFailure(command: string, details: GitFailureDetails, installUrl: string): GitError {
  const message = `git ${command} failed: ${summarize(details)}`
  const rule = RULES.find((candidate) => candidate.patterns.some((pattern) => pattern.test(details.stderr)))
  return rule === undefined ? new GitCommandError(message, details) : rule.create(message, details, installUrl)
}
