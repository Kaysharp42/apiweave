/**
 * What starting a workspace's sync came to: `failure` says what stopped it
 * after the workspace existed, `note` something to know about a sync that
 * did finish, and `identityMissing` that git knows no author — the one stop
 * that can be cleared without leaving the dialog. `mergeWaiting` says the
 * repository and the device share no history, so a merge waits to be resolved
 * from Version history.
 */
export interface WorkspaceSyncOutcome {
  readonly failure: string | null;
  readonly note: string | null;
  readonly identityMissing: boolean;
  readonly mergeWaiting: boolean;
}
