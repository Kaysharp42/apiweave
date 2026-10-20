import { useEffect, useState } from "react";
import type { GitMergeConflict } from "@shared/types/GitMergeConflict";
import type { GitMergeSide } from "@shared/types/GitMergeSide";
import type { MergeRecordCommits } from "@shared/types/MergeRecordCommits";
import { Button } from "../atoms/Button";
import { Spinner } from "../atoms/Spinner";
import { ConfirmDialog } from "../molecules/ConfirmDialog";
import { GitMergeRecord } from "../molecules/GitMergeRecord";
import { Modal } from "../molecules/Modal";
import { git } from "../../utils/apiweaveClient";
import { describeConflictCount } from "../../utils/mergeCommits";
import {
  allConflictsPicked,
  groupConflicts,
  picksRequest,
  withPathPick,
  withWholeRecordPick,
} from "../../utils/mergePicks";
import type { GitMergeDialogProps } from "../../types";

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Who last wrote each of the listed records, both copies. `null` when the
 * details cannot be read: they are display only and never block a choice.
 */
async function fetchCommits(
  workspaceId: string,
  listed: readonly GitMergeConflict[],
): Promise<ReadonlyMap<string, MergeRecordCommits> | null> {
  const recordIds = [...new Set(listed.map((conflict) => conflict.recordId))];
  if (recordIds.length === 0) return new Map();
  try {
    const found = await git.mergeRecordCommits(workspaceId, recordIds);
    return new Map(found.map((entry) => [entry.recordId, entry]));
  } catch {
    return null;
  }
}

/**
 * The merge picker: every conflict the merge is waiting on, one card per
 * record or file, with both copies' values and a choice per field or for the
 * whole record. A dialog rather than a page — it opens over the canvas from the
 * header or the settings panel and closes back onto the same place — for the
 * same reason the commit and discard dialogs are dialogs.
 *
 * The request always carries every decision made so far: the server replaces
 * its stored picks each time, so a resolve that leaves conflicts reloads them
 * and keeps the earlier decisions for the next finish to send again.
 *
 * Abandon is the deliberate way out: it keeps every local commit and change,
 * pushes nothing, and asks before it does that.
 */
export function GitMergeDialog({
  status,
  onClose,
  onStatus,
}: GitMergeDialogProps) {
  const { workspaceId } = status;
  const [conflicts, setConflicts] = useState<readonly GitMergeConflict[] | null>(
    null,
  );
  const [commits, setCommits] = useState<ReadonlyMap<string, MergeRecordCommits>>(
    new Map(),
  );
  const [commitDetailsFailed, setCommitDetailsFailed] = useState(false);
  const [picks, setPicks] = useState<ReadonlyMap<string, GitMergeSide>>(
    new Map(),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirmAbandon, setConfirmAbandon] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      let listed: readonly GitMergeConflict[];
      try {
        listed = await git.mergeConflicts(workspaceId);
      } catch (failure) {
        if (live) setError(errorText(failure));
        return;
      }
      if (!live) return;
      setConflicts(listed);
      const details = await fetchCommits(workspaceId, listed);
      if (!live) return;
      if (details === null) {
        setCommitDetailsFailed(true);
      } else {
        setCommitDetailsFailed(false);
        setCommits(details);
      }
    })();
    return () => {
      live = false;
    };
  }, [workspaceId]);

  const canFinish = conflicts !== null && allConflictsPicked(conflicts, picks);

  const reload = async (): Promise<void> => {
    const listed = await git.mergeConflicts(workspaceId);
    setConflicts(listed);
    // A redo can turn up a conflict in a record the first list did not have,
    // so every listed record's commits are read again for its card. The picks
    // stay exactly as they are: the server replaces its stored set with each
    // request, so the next finish must carry the earlier decisions too.
    const details = await fetchCommits(workspaceId, listed);
    if (details === null) {
      setCommitDetailsFailed(true);
    } else {
      setCommitDetailsFailed(false);
      setCommits(details);
    }
  };

  const finish = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const next = await git.resolveMerge(workspaceId, picksRequest(picks));
      onStatus(next);
      if (next.state !== "merging") {
        onClose();
        return;
      }
      // A merge still waiting after a classified failure — a missing author —
      // says why and keeps every decision; otherwise it lists what is left.
      if (next.lastError !== null && next.lastError.code !== null) {
        setError(next.lastError.message);
      }
      await reload();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  const abandon = async (): Promise<void> => {
    setConfirmAbandon(false);
    setBusy(true);
    setError(null);
    try {
      onStatus(await git.abandonMerge(workspaceId));
      onClose();
    } catch (failure) {
      setError(errorText(failure));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Modal
        isOpen
        onClose={onClose}
        title="Resolve merge"
        size="lg"
        footer={
          <div className="flex w-full flex-wrap items-center justify-between gap-2">
            <Button
              variant="outline"
              intent="error"
              size="sm"
              disabled={busy}
              onClick={() => setConfirmAbandon(true)}
            >
              Abandon merge
            </Button>
            <Button
              variant="primary"
              size="sm"
              disabled={busy || !canFinish}
              loading={busy}
              onClick={() => void finish()}
            >
              Finish merge
            </Button>
          </div>
        }
      >
        <div className="space-y-3 p-4">
          <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
            Both this device and the remote changed these fields. Pick the copy
            to keep for each one. Nothing is pushed or imported until every
            conflict is settled, and every other change from both sides is
            already part of the merge.
          </p>
          {error !== null && (
            <p
              role="alert"
              className="break-words text-sm text-status-error dark:text-[var(--aw-status-error)]"
            >
              {error}
            </p>
          )}
          {conflicts === null ? (
            error === null && (
              <div className="flex justify-center py-8">
                <Spinner size="md" />
              </div>
            )
          ) : conflicts.length === 0 ? (
            <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
              No conflicts are waiting. Finish merge commits the merge, or
              abandon it and keep this device&apos;s commits as they are.
            </p>
          ) : (
            <>
              <p className="text-xs text-text-muted dark:text-text-muted-dark">
                {describeConflictCount(conflicts.length)}
              </p>
              <ul className="space-y-3" aria-label="Merge conflicts">
                {groupConflicts(conflicts).map((group) => (
                  <GitMergeRecord
                    key={`${group.kind}\0${group.recordId}`}
                    group={group}
                    picks={picks}
                    commits={commits.get(group.recordId)}
                    commitDetailsFailed={commitDetailsFailed}
                    disabled={busy}
                    onWholeRecord={(side) =>
                      setPicks((current) =>
                        withWholeRecordPick(current, group.recordId, side),
                      )
                    }
                    onPath={(path, side) =>
                      setPicks((current) =>
                        withPathPick(current, group.recordId, path, side),
                      )
                    }
                  />
                ))}
              </ul>
            </>
          )}
        </div>
      </Modal>
      <ConfirmDialog
        open={confirmAbandon}
        onClose={() => setConfirmAbandon(false)}
        onConfirm={() => void abandon()}
        title="Abandon this merge?"
        message="Every local commit and change stays on this device. Nothing is pushed. You can merge again with Sync now."
        confirmLabel="Abandon merge"
        intent="warning"
      />
    </>
  );
}
