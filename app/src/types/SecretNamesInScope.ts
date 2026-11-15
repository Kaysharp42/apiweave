export interface SecretNamesInScope {
  /** Null until the list has loaded: a missing secret is only reported once it is known to be missing. */
  readonly names: readonly string[] | null;
  readonly workspaceId: string | null;
  readonly environmentId: string | null;
  /** Read the list again, after a secret was saved. */
  readonly refresh: () => void;
}
