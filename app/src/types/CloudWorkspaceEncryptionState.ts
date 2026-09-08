/**
 * What the UI renders for one bound workspace. Mirrors core's
 * `CloudWorkspaceEncryptionState`.
 *
 * `locked` and `unknown` both mean sync is HALTED for that workspace — the
 * difference is that `unknown` resolves itself on the next catalog refresh, so
 * it reads as "checking", never as a failure.
 */
export type CloudWorkspaceEncryptionState =
  "plaintext" | "unlocked" | "locked" | "unknown";
