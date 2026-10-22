/**
 * How a git failure is classified (`core/git/git_errors.ts`). Shared because
 * the renderer acts on the code — `identity_missing` asks for a name and an
 * address — and must never read git's text to find out why.
 */
export type GitErrorCode =
  | "git_not_installed"
  | "identity_missing"
  | "auth_failed"
  | "non_fast_forward"
  | "permission_denied"
  | "network_error"
  | "not_a_repository"
  | "timeout"
  | "invalid_argument"
  | "command_failed"
