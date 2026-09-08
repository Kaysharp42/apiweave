export interface CloudCreateTeamWorkspaceInput {
  readonly name: string;
  readonly slug: string;
  readonly description?: string | null;
  readonly teamId?: string;
  readonly newTeamName?: string;
  /** Set to create the workspace end-to-end encrypted. Permanent — omit for plaintext. */
  readonly passphrase?: string;
}
