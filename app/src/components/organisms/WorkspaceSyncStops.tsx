import { GitAuthorForm } from "./GitAuthorForm";
import type { WorkspaceSyncStopsProps } from "../../types";

/**
 * Where a new workspace's sync stopped, in its dialog: git needs to be told
 * who makes the commits, which the dialog asks for here; or anything else,
 * which Version history finishes.
 */
export function WorkspaceSyncStops({ sync, busy, onCommitAuthor }: WorkspaceSyncStopsProps) {
  return (
    <>
      {sync.awaitingAuthor !== null && (
        <div className="space-y-2 rounded-sm border border-border px-3 py-2 dark:border-border-dark">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            The workspace is created and tracked. Tell git who is making its
            commits, and APIWeave creates the repository and connects it
            straight away.
          </p>
          {sync.authorError !== null && (
            <div role="alert" className="text-sm text-status-error">
              {sync.authorError}
            </div>
          )}
          <GitAuthorForm busy={busy} onCommit={onCommitAuthor} />
        </div>
      )}

      {sync.unfinished !== null && (
        <div
          role="alert"
          className="rounded-sm border border-status-warning/30 bg-status-warning/10 px-3 py-2 text-sm text-text-primary dark:bg-status-warning/20 dark:text-text-primary-dark"
        >
          {sync.unfinished.message}
        </div>
      )}
    </>
  );
}
